import { MongoServerError, type ClientSession, type Db, type MongoClient } from 'mongodb';
import { LOCAL_TABLES, SyncError, contentHash, rowKeyText, type Operation, type RowChange, type Scalar } from './validate.js';

// Kiracı kimliği her sorguda koşuldur; kiracısız okuma veya yazma yoktur.
//
// Sıra kuralı: gönderim kiracı belgesine yazarak başlar. Aynı kiracıya eşzamanlı iki gönderim
// aynı belgeye yazdığı için biri yazma çakışmasıyla geri alınır ve baştan çalışır; böylece
// sıra boşluksuz ve tekil kalır. Okuma uçları anlık görüntü transaction'ında çalışır: okuyan
// hiçbir zaman yarım onaylanmış bir gönderim görmez.
//
// `sync_operation` eklemeli bir günlüktür: bu modül günlüğe yalnız ekleme yapar. Tek silme
// yolu hesabın silinmesidir (`removeUserData`).

export interface BusinessStore {
  db: Db;
  client: MongoClient;
}

interface QuarantinedOperation {
  tenant_id: string;
  operation_id: string;
  user_id: string;
  device_id: string;
  content_sha256: string;
  operation: Operation;
  changes: RowChange[];
  status: 'pending' | 'accepted' | 'rejected';
  received_at: Date;
  resolved_at?: Date;
  resolved_by?: string;
  resolution_reason?: string;
}
interface QuarantineDecision {
  tenant_id: string;
  operation_id: string;
  decision: 'accept' | 'reject';
  resolved_by: string;
  reason: string;
  content_sha256: string;
  resolved_at: Date;
}

const quarantine = (db: Db) => db.collection<QuarantinedOperation>('sync_quarantine');
const quarantineDecisions = (db: Db) => db.collection<QuarantineDecision>('sync_quarantine_decision');

export interface Accepted {
  operationId: string;
  seq: number;
  duplicate: boolean;
}

export interface PulledOperation extends Operation {
  seq: number;
}

interface TenantDoc {
  tenant_id: string;
  user_id: string;
  last_seq: number;
  created_at: Date;
  touched_at: Date;
}

interface OperationDoc {
  tenant_id: string;
  seq: number;
  operation_id: string;
  device_id: string;
  pushed_by: string;
  actor_id: string;
  actor_role: string;
  kind: string;
  intent_sha256: string;
  content_sha256: string;
  /** Gönderilen gövde birebir saklanır; sayı ve alan sırası değişmesin diye metindir. */
  payload: string;
  created_at: string;
  received_at: Date;
}

interface RowDoc {
  tenant_id: string;
  table_name: string;
  row_key: string;
  key: Record<string, Scalar>;
  data: Record<string, Scalar> | null;
  deleted: boolean;
  last_seq: number;
  updated_at: Date;
}

interface CursorDoc {
  tenant_id: string;
  device_id: string;
  pulled_seq: number;
  last_push_at: Date | null;
  last_pull_at: Date | null;
  released_at: Date | null;
}

interface RowState {
  table: string;
  rowKey: string;
  key: Record<string, Scalar>;
  data: Record<string, Scalar> | null;
  seq: number;
}

const tenants = (db: Db) => db.collection<TenantDoc>('sync_tenant');
const operations = (db: Db) => db.collection<OperationDoc>('sync_operation');
const rows = (db: Db) => db.collection<RowDoc>('sync_row');
const cursors = (db: Db) => db.collection<CursorDoc>('sync_device_cursor');

const SNAPSHOT = { readConcern: { level: 'snapshot' as const }, writeConcern: { w: 'majority' as const } };
const WRITE = { readConcern: { level: 'majority' as const }, writeConcern: { w: 'majority' as const } };

async function inTransaction<T>(
  client: MongoClient, options: typeof SNAPSHOT | typeof WRITE, work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    let result: T | undefined;
    let done = false;
    // Yazma çakışmasında sürücü transaction'ı baştan çalıştırır; sonuç yalnız onaylanan turdan alınır.
    await session.withTransaction(async () => {
      result = await work(session);
      done = true;
    }, options);
    if (!done) throw new Error('Transaction tamamlanmadı.');
    return result as T;
  } finally {
    await session.endSession();
  }
}

const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000;

export async function boundTenant(db: Db, userId: string, session?: ClientSession) {
  // Bu eski uç tenant parametresi taşımadığından tek-tenant lisansıyla sınırlı tutulur.
  // Çoklu üyelik kullanan hesap, C02 sync route sürümlenene dek buradan iş verisi alamaz.
  const memberships = await db.collection<{ tenantId: string }>('tenant_membership')
    .find({ userId, status: 'active' }, { session, projection: { tenantId: 1 } }).toArray();
  if (memberships.length > 1) return null;
  const legacy = await tenants(db).findOne({ user_id: userId }, { session });
  if (memberships.length === 1 && memberships[0]?.tenantId !== legacy?.tenant_id) return null;
  return legacy ? { tenantId: legacy.tenant_id, lastSeq: legacy.last_seq } : null;
}

async function tenantById(db: Db, tenantId: string, session: ClientSession) {
  const found = await tenants(db).findOne({ tenant_id: tenantId }, { session });
  return found ? { tenantId: found.tenant_id, lastSeq: found.last_seq } : null;
}

/** İlk gönderim hesabı kiracıya bağlar; sonra başka kiracı kabul edilmez. Belgeye yazılarak kilitlenir. */
async function lockTenant(db: Db, session: ClientSession, userId: string, tenantId: string, tenantScoped = false) {
  if (tenantScoped) {
    const scopedUserId = `tenant:${tenantId}`;
    let tenant: TenantDoc | null;
    try {
      tenant = await tenants(db).findOneAndUpdate(
        { tenant_id: tenantId },
        { $set: { touched_at: new Date() }, $setOnInsert: { tenant_id: tenantId, user_id: scopedUserId, last_seq: 0, created_at: new Date() } },
        { upsert: true, returnDocument: 'after', session },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw new SyncError(409, 'TENANT_TAKEN', 'İşletme eşitleme akışı çakıştı.');
      throw error;
    }
    if (!tenant) throw new SyncError(409, 'TENANT_TAKEN', 'İşletme eşitleme akışı açılamadı.');
    return tenant.last_seq;
  }
  let tenant: TenantDoc | null;
  try {
    tenant = await tenants(db).findOneAndUpdate(
      { user_id: userId },
      { $set: { touched_at: new Date() }, $setOnInsert: { tenant_id: tenantId, user_id: userId, last_seq: 0, created_at: new Date() } },
      { upsert: true, returnDocument: 'after', session },
    );
  } catch (error) {
    // Kiracı kimliği tekildir: başka hesaba bağlı kiracıya yeni hesap bağlanamaz.
    if (isDuplicateKey(error)) throw new SyncError(409, 'TENANT_TAKEN', 'Bu işletme başka bir hesaba bağlı.');
    throw error;
  }
  if (!tenant) throw new SyncError(409, 'TENANT_TAKEN', 'Bu işletme başka bir hesaba bağlı.');
  if (tenant.tenant_id !== tenantId) throw new SyncError(403, 'TENANT_MISMATCH', 'Bu hesap başka bir işletmeye bağlı.');
  return tenant.last_seq;
}

/** Bir gönderimin satır etkisini sıra sırasıyla toplar; aynı satıra son yazan kazanır. */
function rowStates(items: { changes: RowChange[]; seq: number }[]): RowState[] {
  const states = new Map<string, RowState>();
  const put = (table: string, key: Record<string, Scalar>, data: RowState['data'], seq: number) => {
    const rowKey = rowKeyText(key);
    states.set(JSON.stringify([table, rowKey]), { table, rowKey, key, data, seq });
  };
  for (const { changes, seq } of items) {
    for (const change of changes) {
      if (LOCAL_TABLES.includes(change.table) || !change.key) continue;
      if (change.action === 'D' || !change.row) {
        put(change.table, change.key, null, seq);
        continue;
      }
      const row = change.row;
      // Güncelleme birincil anahtarı değiştirdiyse eski anahtar silinmiş sayılır.
      const next = Object.fromEntries(Object.keys(change.key).map((column) => [column, row[column]])) as Record<string, Scalar>;
      if (rowKeyText(next) !== rowKeyText(change.key)) put(change.table, change.key, null, seq);
      put(change.table, next, row, seq);
    }
  }
  return [...states.values()];
}

async function applyRows(db: Db, session: ClientSession, tenantId: string, states: RowState[]) {
  if (states.length === 0) return;
  const now = new Date();
  await rows(db).bulkWrite(states.map((state) => ({
    updateOne: {
      filter: { tenant_id: tenantId, table_name: state.table, row_key: state.rowKey },
      update: { $set: { key: state.key, data: state.data, deleted: state.data === null, last_seq: state.seq, updated_at: now } },
      upsert: true,
    },
  })), { session, ordered: true });
}

async function touchCursor(db: Db, tenantId: string, deviceId: string, field: 'last_push_at' | 'last_pull_at', session?: ClientSession) {
  await cursors(db).updateOne(
    { tenant_id: tenantId, device_id: deviceId },
    { $set: { [field]: new Date(), released_at: null }, $setOnInsert: { pulled_seq: 0 } },
    { upsert: true, session },
  );
}

/** Gönderim tek transaction'dır: ya hepsi sıra alır ya hiçbiri. */
export function pushOperations(
  { db, client }: BusinessStore, userId: string, pushedBy: string, tenantId: string,
  items: { operation: Operation; changes: RowChange[] }[], tenantScoped = false,
): Promise<{ accepted: Accepted[]; lastSeq: number }> {
  return inTransaction(client, WRITE, (session) => pushOperationsInTransaction(db, session, userId, pushedBy, tenantId, items, tenantScoped));
}

async function pushOperationsInTransaction(
  db: Db, session: ClientSession, userId: string, pushedBy: string, tenantId: string,
  items: { operation: Operation; changes: RowChange[] }[], tenantScoped = false, reviewOperationId?: string,
) {
    const operationIds = items.map((item) => item.operation.operationId);
    const unresolved = await quarantine(db).find(
      { tenant_id: tenantId, operation_id: { $in: operationIds, ...(reviewOperationId ? { $nin: [reviewOperationId] } : {}) }, status: { $in: ['pending', 'rejected'] } },
      { session, projection: { operation_id: 1, status: 1 } },
    ).toArray();
    if (unresolved.length > 0) {
      const first = unresolved.find((item) => item.status === 'rejected') ?? unresolved[0];
      if (first?.status === 'rejected') {
        const decision = await quarantineDecisions(db).findOne({ tenant_id: tenantId, operation_id: first.operation_id }, { session });
        throw new SyncError(409, 'OPERATION_REJECTED', 'İşletme sahibi bu işlemi reddetti.', { operationId: first.operation_id, reason: decision?.reason ?? 'İşletme sahibi kaydı reddetti.' });
      }
      throw new SyncError(409, 'OPERATION_PENDING_REVIEW', 'İşlem işletme sahibi incelemesini bekliyor.', { operationId: first?.operation_id });
    }
    let seq = await lockTenant(db, session, userId, tenantId, tenantScoped);
    const existing = await operations(db).find(
      { tenant_id: tenantId, operation_id: { $in: items.map((item) => item.operation.operationId) } },
      { session, projection: { operation_id: 1, seq: 1, content_sha256: 1 } },
    ).toArray();
    const stored = new Map(existing.map((row) => [row.operation_id, row]));
    const accepted: Accepted[] = [];
    const fresh: { operation: Operation; changes: RowChange[]; seq: number; hash: string }[] = [];
    for (const item of items) {
      const hash = contentHash(item.operation);
      const known = stored.get(item.operation.operationId);
      if (known) {
        if (known.content_sha256 !== hash) {
          throw new SyncError(409, 'OPERATION_CONFLICT', 'Aynı işlem kimliği farklı içerikle gönderildi.', { operationId: item.operation.operationId });
        }
        accepted.push({ operationId: item.operation.operationId, seq: known.seq, duplicate: true });
        continue;
      }
      seq += 1;
      fresh.push({ ...item, seq, hash });
      accepted.push({ operationId: item.operation.operationId, seq, duplicate: false });
    }
    if (fresh.length > 0) {
      const receivedAt = new Date();
      await operations(db).insertMany(fresh.map((item) => ({
        tenant_id: tenantId,
        seq: item.seq,
        operation_id: item.operation.operationId,
        device_id: item.operation.deviceId,
        pushed_by: pushedBy,
        actor_id: item.operation.actorId,
        actor_role: item.operation.actorRole,
        kind: item.operation.op.domain,
        intent_sha256: item.operation.intentSha256,
        content_sha256: item.hash,
        payload: JSON.stringify(item.operation.op),
        created_at: item.operation.createdAt,
        received_at: receivedAt,
      })), { session, ordered: true });
      await tenants(db).updateOne({ tenant_id: tenantId }, { $set: { last_seq: seq } }, { session });
      await applyRows(db, session, tenantId, rowStates(fresh));
    }
    await touchCursor(db, tenantId, pushedBy, 'last_push_at', session);
    return { accepted, lastSeq: seq };
}

/** Süresi dolmuş cihazın gecikmiş kayıtlarını saklar; bunlar sıralı işletme verisine girmez. */
export async function holdExpiredOperations(
  { db, client }: BusinessStore, userId: string, deviceId: string, tenantId: string,
  items: { operation: Operation; changes: RowChange[] }[], tenantScoped = false,
) {
  return inTransaction(client, WRITE, async (session) => {
    await lockTenant(db, session, userId, tenantId, tenantScoped);
    const held: { operationId: string; status: string }[] = [];
    for (const item of items) {
      const operationId = item.operation.operationId;
      const hash = contentHash(item.operation);
      const existing = await quarantine(db).findOne({ tenant_id: tenantId, operation_id: operationId }, { session });
      if (existing) {
        if (existing.content_sha256 !== hash) throw new SyncError(409, 'OPERATION_CONFLICT', 'Aynı işlem kimliği farklı içerikle gönderildi.', { operationId });
        if (existing.status === 'rejected') throw new SyncError(409, 'OPERATION_REJECTED', 'İşletme sahibi bu işlemi reddetti.', { operationId });
        held.push({ operationId, status: existing.status });
        continue;
      }
      const committed = await operations(db).findOne({ tenant_id: tenantId, operation_id: operationId }, { session, projection: { content_sha256: 1 } });
      if (committed) {
        if (committed.content_sha256 !== hash) throw new SyncError(409, 'OPERATION_CONFLICT', 'Aynı işlem kimliği farklı içerikle gönderildi.', { operationId });
        held.push({ operationId, status: 'accepted' });
        continue;
      }
      await quarantine(db).insertOne({
        tenant_id: tenantId, operation_id: operationId, user_id: userId, device_id: deviceId,
        content_sha256: hash, operation: item.operation, changes: item.changes, status: 'pending', received_at: new Date(),
      }, { session });
      held.push({ operationId, status: 'pending' });
    }
    return held;
  });
}

export async function pendingQuarantinedOperations(db: Db, tenantId: string) {
  return quarantine(db).find({ tenant_id: tenantId, status: 'pending' })
    .sort({ received_at: 1, operation_id: 1 }).toArray();
}

/** OWNER kararı sonrası kayıt normal sıra ve satır durumuna aynı idempotency anahtarıyla alınır. */
export async function resolveQuarantinedOperation(
  business: BusinessStore, userId: string, tenantId: string, operationId: string,
  decision: 'accept' | 'reject', resolvedBy: string, reason: string,
) {
  return inTransaction(business.client, WRITE, async (session) => {
    const held = await quarantine(business.db).findOne({ tenant_id: tenantId, operation_id: operationId }, { session });
    if (!held) throw new SyncError(404, 'NOT_FOUND', 'Bekletilen işlem bulunamadı.');
    const prior = await quarantineDecisions(business.db).findOne({ tenant_id: tenantId, operation_id: operationId }, { session });
    if (prior && prior.decision !== decision) {
      throw new SyncError(409, prior.decision === 'reject' ? 'OPERATION_REJECTED' : 'OPERATION_ALREADY_ACCEPTED', 'İşlem farklı bir kararla daha önce uzlaştırıldı.', { operationId });
    }
    if (held.status === 'rejected' && decision === 'accept') throw new SyncError(409, 'OPERATION_REJECTED', 'İşlem daha önce reddedildi.', { operationId });
    if (held.status === 'accepted' && decision === 'reject') throw new SyncError(409, 'OPERATION_ALREADY_ACCEPTED', 'İşlem daha önce kabul edildi.', { operationId });
    const result = decision === 'accept'
      ? await pushOperationsInTransaction(business.db, session, userId, held.device_id, tenantId, [{ operation: held.operation, changes: held.changes }], true, operationId)
      : null;
    const status = decision === 'accept' ? 'accepted' : 'rejected';
    if (!prior) await quarantineDecisions(business.db).insertOne({
      tenant_id: tenantId, operation_id: operationId, decision, resolved_by: resolvedBy,
      reason, content_sha256: held.content_sha256, resolved_at: new Date(),
    }, { session });
    await quarantine(business.db).updateOne(
      { tenant_id: tenantId, operation_id: operationId, status: 'pending' },
      { $set: { status, resolved_at: new Date(), resolved_by: resolvedBy, resolution_reason: reason } },
      { session },
    );
    const effectiveStatus = held.status === 'accepted' ? 'accepted' : status;
    return { operationId, status: effectiveStatus, accepted: result?.accepted ?? [], lastSeq: result?.lastSeq ?? null };
  });
}

export async function pullOperations({ db, client }: BusinessStore, userId: string, deviceId: string, after: number, limit: number, tenantId?: string) {
  const page = await inTransaction(client, SNAPSHOT, async (session) => {
    const tenant = tenantId
      ? await tenantById(db, tenantId, session)
      : await boundTenant(db, userId, session);
    if (!tenant) return null;
    if (after > tenant.lastSeq) throw new SyncError(409, 'CURSOR_AHEAD', 'Kasanın sırası sunucudan ileride.', { lastSeq: tenant.lastSeq });
    const found = await operations(db).find({ tenant_id: tenant.tenantId, seq: { $gt: after } }, { session })
      .sort({ seq: 1 }).limit(limit).toArray();
    return { tenant, found };
  });
  if (!page) return { tenantId: null, operations: [], nextAfter: after, hasMore: false, lastSeq: 0 };
  const { tenant, found } = page;
  const nextAfter = found.length > 0 ? found[found.length - 1].seq : after;
  // Kasanın kendi gönderdiği işlem zaten kendisindedir; sıra yine de ilerler.
  const pulled: PulledOperation[] = found.filter((row) => row.pushed_by !== deviceId).map((row) => ({
    seq: row.seq,
    operationId: row.operation_id,
    tenantId: tenant.tenantId,
    deviceId: row.device_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    intentSha256: row.intent_sha256,
    op: JSON.parse(row.payload) as Operation['op'],
    createdAt: row.created_at,
  }));
  // `after` istemcinin elindeki son sıradır; imleç geri gitmez.
  await cursors(db).updateOne(
    { tenant_id: tenant.tenantId, device_id: deviceId },
    { $max: { pulled_seq: after }, $set: { last_pull_at: new Date(), released_at: null } },
    { upsert: true },
  );
  return { tenantId: tenant.tenantId, operations: pulled, nextAfter, hasMore: nextAfter < tenant.lastSeq, lastSeq: tenant.lastSeq };
}

export interface SnapshotCursor {
  table: string;
  rowKey: string;
}

/** Sayfa, `asOf` sırasındaki durumdan bu yana değişmemiş satırlardır; gerisi `pull` ile gelir. */
export async function snapshotPage(
  { db, client }: BusinessStore, userId: string, deviceId: string, asOf: number | null, cursor: SnapshotCursor | null, limit: number, tenantId?: string,
) {
  const page = await inTransaction(client, SNAPSHOT, async (session) => {
    const tenant = tenantId
      ? await tenantById(db, tenantId, session)
      : await boundTenant(db, userId, session);
    if (!tenant) return null;
    const pinned = asOf ?? tenant.lastSeq;
    if (pinned > tenant.lastSeq) throw new SyncError(409, 'CURSOR_AHEAD', 'Anlık görüntü sırası sunucudan ileride.', { lastSeq: tenant.lastSeq });
    const after = cursor
      ? { $or: [{ table_name: { $gt: cursor.table } }, { table_name: cursor.table, row_key: { $gt: cursor.rowKey } }] }
      : {};
    const found = await rows(db).find(
      { tenant_id: tenant.tenantId, deleted: false, last_seq: { $lte: pinned }, ...after },
      { session, projection: { table_name: 1, row_key: 1, key: 1, data: 1 } },
    ).sort({ table_name: 1, row_key: 1 }).limit(limit + 1).toArray();
    return { tenant, pinned, found };
  });
  if (!page) return { tenantId: null, asOfSeq: 0, rows: [], next: null };
  const more = page.found.length > limit;
  const list = more ? page.found.slice(0, limit) : page.found;
  const last = list[list.length - 1];
  if (!cursor) await touchCursor(db, page.tenant.tenantId, deviceId, 'last_pull_at');
  return {
    tenantId: page.tenant.tenantId,
    asOfSeq: page.pinned,
    rows: list.map((row) => ({ table: row.table_name, key: row.key, row: row.data })),
    next: more && last ? { table: last.table_name, rowKey: last.row_key } : null,
  };
}

/** Çıkışta kasanın ürettiği işlemlerin tamamı bulutta mı; değilse yerel veri silinmemeli. */
export async function releaseDevice(
  { db, client }: BusinessStore, userId: string, deviceId: string,
  claim: { tenantId: string; originDeviceId: string; lastOperationId: string | null; operationCount: number },
  tenantScoped = false,
) {
  return inTransaction(client, WRITE, async (session) => {
    const tenant = tenantScoped
      ? await tenantById(db, claim.tenantId, session)
      : await boundTenant(db, userId, session);
    if (!tenant) {
      if (claim.operationCount === 0 && claim.lastOperationId === null) return { safeToWipe: true, lastSeq: 0, serverCount: 0 };
      throw new SyncError(409, 'PENDING_OPERATIONS', 'Bulutta bu kasanın işlemleri eksik.', { safeToWipe: false, serverCount: 0 });
    }
    if (tenant.tenantId !== claim.tenantId) throw new SyncError(403, 'TENANT_MISMATCH', 'Bu hesap başka bir işletmeye bağlı.', { safeToWipe: false });
    const scope = { tenant_id: tenant.tenantId, device_id: claim.originDeviceId };
    const serverCount = await operations(db).countDocuments(scope, { session });
    const lastPresent = claim.lastOperationId === null
      ? serverCount === 0
      : (await operations(db).countDocuments({ ...scope, operation_id: claim.lastOperationId }, { session, limit: 1 })) === 1;
    if (serverCount !== claim.operationCount || !lastPresent) {
      throw new SyncError(409, 'PENDING_OPERATIONS', 'Bulutta bu kasanın işlemleri eksik.', { safeToWipe: false, serverCount });
    }
    await cursors(db).updateOne(
      { tenant_id: tenant.tenantId, device_id: deviceId },
      { $set: { released_at: new Date() }, $setOnInsert: { pulled_seq: 0 } },
      { upsert: true, session },
    );
    return { safeToWipe: true, lastSeq: tenant.lastSeq, serverCount };
  });
}
