import { createHash } from 'node:crypto';

// Kasadan gelen işlem burada tam doğrulanır. Sunucu işlemi yeniden yorumlamaz; yalnız biçimi,
// kiracıyı ve sayıların kayıpsız taşındığını denetler. Bozuk tek işlem bütün gönderimi düşürür.

export const LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxOperations: 500,
  maxChanges: 10_000,
  maxDepth: 32,
  maxKeyBytes: 1024,
  pullDefault: 200,
  pullMax: 500,
  snapshotDefault: 500,
  snapshotMax: 1000,
} as const;

/** Kasada yerel kalan tablolar: günlükte durur ama satır durumuna ve anlık görüntüye girmez. */
export const LOCAL_TABLES: readonly string[] = ['approvals', 'email_queue', 'outbox', 'whatsapp_queue'];

export const TENANT_ID = /^[a-z]{2,4}_[0-9A-Za-z]{1,40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const ROLE = /^[A-Za-z_]{1,32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
// Boş karakter ve eşsiz vekil güvenle saklanamaz ve satır anahtarını bozar; sessizce bozulmak yerine reddedilir.
const UNSTORABLE = /\u0000|\p{Cs}/u;

export type Scalar = string | number | boolean | null;
export type Json = Scalar | Json[] | { [key: string]: Json };
export type Kind = 'CHANGES' | 'CARI' | 'SET_MEMBERS' | 'NOOP';
export type Action = 'I' | 'U' | 'D';

export interface RowChange {
  table: string;
  action: Action;
  key: Record<string, Scalar> | null;
  row: Record<string, Scalar> | null;
}

export interface Operation {
  operationId: string;
  tenantId: string;
  deviceId: string;
  actorId: string;
  actorRole: string;
  intentSha256: string;
  op: { domain: Kind; body?: Json };
  createdAt: string;
}

export type SyncStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422;

export class SyncError extends Error {
  constructor(
    readonly status: SyncStatus,
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const invalid = (index: number, field: string) =>
  new SyncError(422, 'INVALID_OPERATION', 'İşlem biçimi geçersiz.', { index, field });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON değerini dolaşır; kayıpsız saklanamayan sayı ve metni bulur. */
function storable(value: unknown, depth: number): boolean {
  if (depth > LIMITS.maxDepth) return false;
  if (value === null || typeof value === 'boolean') return true;
  // Güvenli aralık dışındaki tamsayı JavaScript'te yuvarlanmış gelir; kuruş kaybı kabul edilmez.
  if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (typeof value === 'string') return !UNSTORABLE.test(value);
  if (Array.isArray(value)) return value.every((item) => storable(item, depth + 1));
  if (isObject(value)) return Object.entries(value).every(([key, item]) => !UNSTORABLE.test(key) && storable(item, depth + 1));
  return false;
}

function columns(value: unknown, allowEmpty: boolean): Record<string, Scalar> | null {
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  if (!allowEmpty && entries.length === 0) return null;
  for (const [column, item] of entries) {
    if (!COLUMN.test(column) || (item !== null && typeof item === 'object')) return null;
  }
  return value as Record<string, Scalar>;
}

/** Anahtarın sabit metni: sütun sırası farklı gelse de aynı satır aynı metni alır. */
export function rowKeyText(key: Record<string, Scalar>): string {
  return JSON.stringify(Object.keys(key).sort().map((column) => [column, key[column]]));
}

function sameValue(left: Scalar | undefined, right: Scalar) {
  return left !== undefined && left === right;
}

function parseChange(raw: unknown, index: number, tenantId: string): RowChange {
  if (!isObject(raw)) throw invalid(index, 'changes');
  const { table, action } = raw;
  if (typeof table !== 'string' || !TABLE.test(table) || table.startsWith('sync_')) throw invalid(index, 'table');
  if (action !== 'I' && action !== 'U' && action !== 'D') throw invalid(index, 'action');
  const key = raw.key === null || raw.key === undefined ? null : columns(raw.key, false);
  const row = raw.row === null || raw.row === undefined ? null : columns(raw.row, true);
  if (raw.key !== null && raw.key !== undefined && !key) throw invalid(index, 'key');
  if (raw.row !== null && raw.row !== undefined && !row) throw invalid(index, 'row');
  // Satır kendi anahtarını taşımazsa sunucu birincil anahtarı bilemez; ekleme de anahtarla gelir.
  if (!key) throw invalid(index, 'key');
  if (Buffer.byteLength(rowKeyText(key)) > LIMITS.maxKeyBytes) throw invalid(index, 'key');
  if (action !== 'D') {
    if (!row) throw invalid(index, 'row');
    const keyColumns = Object.keys(key);
    if (!keyColumns.every((column) => column in row)) throw invalid(index, 'row');
    if (action === 'I' && !keyColumns.every((column) => sameValue(row[column], key[column]))) throw invalid(index, 'key');
  }
  for (const values of [key, row]) {
    if (values && 'tenant_id' in values && values.tenant_id !== tenantId) {
      throw new SyncError(403, 'TENANT_MISMATCH', 'İşlem başka bir işletmeye ait.', { index });
    }
  }
  return { table, action, key, row: action === 'D' ? null : row };
}

/** Tek işlemi doğrular; dönen değer yalnız bilinen alanları taşır. */
export function parseOperation(raw: unknown, index: number, tenantId: string): { operation: Operation; changes: RowChange[] } {
  if (!isObject(raw)) throw invalid(index, 'operation');
  const text = (field: string, pattern: RegExp) => {
    const value = raw[field];
    if (typeof value !== 'string' || !pattern.test(value)) throw invalid(index, field);
    return value;
  };
  const operationId = text('operationId', ID);
  const opTenant = text('tenantId', TENANT_ID);
  if (opTenant !== tenantId) throw new SyncError(403, 'TENANT_MISMATCH', 'İşlem başka bir işletmeye ait.', { index });
  const deviceId = text('deviceId', ID);
  const actorId = text('actorId', ID);
  const actorRole = text('actorRole', ROLE);
  const intentSha256 = text('intentSha256', SHA256);
  const createdAt = raw.createdAt;
  if (typeof createdAt !== 'string' || createdAt.length > 64 || Number.isNaN(Date.parse(createdAt))) throw invalid(index, 'createdAt');
  const op = raw.op;
  if (!isObject(op) || !storable(op, 0)) throw invalid(index, 'op');
  const { domain, body } = op;
  let changes: RowChange[] = [];
  if (domain === 'CHANGES') {
    if (!isObject(body) || !Number.isSafeInteger(body.base_state) || !Array.isArray(body.changes) ||
        body.changes.length > LIMITS.maxChanges) {
      throw invalid(index, 'op');
    }
    changes = body.changes.map((change) => parseChange(change, index, tenantId));
  } else if (domain === 'CARI') {
    if (!isObject(body)) throw invalid(index, 'op');
  } else if (domain === 'SET_MEMBERS') {
    if (!Array.isArray(body)) throw invalid(index, 'op');
  } else if (domain === 'NOOP') {
    if (body !== undefined && body !== null) throw invalid(index, 'op');
  } else {
    throw invalid(index, 'op.domain');
  }
  const normalized: Operation['op'] = body === undefined || body === null ? { domain } : { domain, body: body as Json };
  return {
    operation: { operationId, tenantId, deviceId, actorId, actorRole, intentSha256, op: normalized, createdAt },
    changes,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Aynı işlem kimliğiyle gelen içeriğin aynı olup olmadığını anahtar sırasından bağımsız ölçer. */
export const contentHash = (operation: Operation) => createHash('sha256').update(canonical(operation)).digest('hex');
