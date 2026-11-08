import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from 'mongodb';
import type { LicenseKeys } from '../desktopLicense.js';
import type { Auth } from '../lib/auth.js';
import { readDevice } from '../license.js';
import type { DeviceLicenses } from './deviceLicenses.js';
import { holdExpiredOperations, pendingQuarantinedOperations, pullOperations, pushOperations, releaseDevice, resolveQuarantinedOperation, snapshotPage, type BusinessStore, type SnapshotCursor } from './store.js';
import { LIMITS, SyncError, TENANT_ID, parseOperation } from './validate.js';

// Kasa ile bulut arasındaki eşitleme uçları; sözleşme docs/cloud-sync.md'dedir.
// Kimlik lisans anahtarıdır: anahtarın sahibi hesap, hesabın bağlı olduğu kiracıyı belirler.

const BASE = '/api/desktop/sync';
const SEQ = /^\d{1,15}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

type Need = 'write' | 'read';

/**
 * Bitiş zamanı ile güvenlik iptali ayrıdır: bitmiş cihaz yalnız bitişinden önce oluşmuş
 * kendi işlemlerini gönderebilir; iptal veya engel push/release dahil tüm erişimi kapatır.
 */
async function authorize(context: Context, keys: LicenseKeys, devices: DeviceLicenses, need: Need, tenantId?: string) {
  const bearer = /^Bearer (\S+)$/.exec(context.req.header('authorization') ?? '')?.[1] ?? '';
  const owner = await keys.find(bearer);
  if (!owner) throw new SyncError(401, 'INVALID_KEY', 'Lisans anahtarı geçersiz. Cihazı yeniden bağlayın.');
  if (!owner.emailVerified) throw new SyncError(403, 'EMAIL_NOT_VERIFIED', 'Önce e-postanızı doğrulayın.');
  const device = readDevice((name) => context.req.header(name));
  if (!device) throw new SyncError(400, 'INVALID_DEVICE', 'Cihaz kimliği geçersiz.');
  const assessment = tenantId
    ? await devices.assessForTenant(owner.id, tenantId, device.id)
    : await devices.assess(owner.id, device.id);
  if (assessment.standing === 'revoked') {
    throw new SyncError(403, 'DEVICE_REVOKED', 'Bu cihazın erişimi iptal edilmiş.');
  }
  if (assessment.standing === 'unknown' || assessment.standing === 'inactive') {
    throw new SyncError(403, 'DEVICE_NOT_LICENSED', 'Bu cihaz için etkin lisans alınmamış.');
  }
  if (assessment.standing === 'blocked') {
    throw new SyncError(403, 'LICENSE_BLOCKED', 'Bu cihaz lisansı engellenmiş.');
  }
  if (need === 'read' && assessment.standing !== 'active') {
    throw new SyncError(403, 'LICENSE_INACTIVE', 'Cihaz lisansı geçerli değil.');
  }
  return { userId: owner.id, deviceId: device.id, assessment };
}

function respond(context: Context, work: () => Promise<Record<string, unknown>>) {
  context.header('Cache-Control', 'no-store');
  return work().then(
    (body) => {
      const status = typeof body.__httpStatus === 'number' ? body.__httpStatus : 200;
      const { __httpStatus: _status, ...result } = body;
      return context.json(result, status as 200 | 202);
    },
    (error: unknown) => {
      if (error instanceof SyncError) return context.json({ code: error.code, message: error.message, ...error.detail }, error.status);
      throw error;
    },
  );
}

async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new SyncError(400, 'INVALID_JSON', 'İstek gövdesi okunamadı.');
  }
}

function readNumber(value: string | undefined, fallback: number, max: number, field: string) {
  if (value === undefined) return fallback;
  if (!SEQ.test(value) || Number(value) > max) throw new SyncError(422, 'INVALID_QUERY', 'Sorgu değeri geçersiz.', { field });
  return Number(value);
}

function readLimit(value: string | undefined, fallback: number, max: number) {
  const limit = readNumber(value, fallback, max, 'limit');
  if (limit < 1) throw new SyncError(422, 'INVALID_QUERY', 'Sorgu değeri geçersiz.', { field: 'limit' });
  return limit;
}

function readCursor(value: string | undefined): SnapshotCursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { table: parsed[0], rowKey: parsed[1] };
    }
  } catch {
    // Bozuk imleç aşağıda tek hata olarak döner.
  }
  throw new SyncError(422, 'INVALID_QUERY', 'Sayfa imleci geçersiz.', { field: 'cursor' });
}

const tooLarge = (context: Context) =>
  context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Gönderim çok büyük; daha küçük parçalara bölün.' }, 413);

export function mountCloudSync(app: Hono, store: BusinessStore, keys: LicenseKeys, devices: DeviceLicenses, accountDb?: Db, auth?: Auth) {
  app.use(`${BASE}/push`, bodyLimit({ maxSize: LIMITS.maxBodyBytes, onError: tooLarge }));
  app.use(`${BASE}/release`, bodyLimit({ maxSize: 4096, onError: tooLarge }));

  app.post(`${BASE}/push`, (context) => respond(context, async () => {
    const { userId, deviceId, assessment } = await authorize(context, keys, devices, 'write');
    const data = await readJson(context);
    const raw = data && typeof data === 'object' && 'operations' in data ? data.operations : undefined;
    if (!Array.isArray(raw) || raw.length === 0) throw new SyncError(422, 'INVALID_OPERATION', 'İşlem listesi boş veya geçersiz.');
    if (raw.length > LIMITS.maxOperations) throw new SyncError(413, 'TOO_MANY_OPERATIONS', 'Bir gönderimde en çok 500 işlem olabilir.');
    const first: unknown = raw[0];
    const tenantId = first && typeof first === 'object' && 'tenantId' in first ? first.tenantId : undefined;
    if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) throw new SyncError(422, 'INVALID_OPERATION', 'İşlem biçimi geçersiz.', { index: 0, field: 'tenantId' });
    const items = raw.map((operation, index) => parseOperation(operation, index, tenantId));
    const expiry = assessment.expiresAt;
    if (assessment.standing === 'expired' && (expiry === null || items.some(({ operation }) => operation.deviceId !== deviceId))) {
      throw new SyncError(403, 'NEW_OPERATION_AFTER_EXPIRY', 'Lisans bittikten sonra oluşturulan işlem gönderilemez.');
    }
    if (new Set(items.map((item) => item.operation.operationId)).size !== items.length) {
      throw new SyncError(422, 'DUPLICATE_OPERATION', 'Aynı işlem bir gönderimde iki kez var.');
    }
    if (items.reduce((total, item) => total + item.changes.length, 0) > LIMITS.maxChanges) {
      throw new SyncError(413, 'TOO_MANY_CHANGES', 'Bir gönderimde en çok 10000 satır değişikliği olabilir.');
    }
    if (assessment.standing === 'expired') {
      const held = await holdExpiredOperations(store, userId, deviceId, tenantId, items);
      if (held.every((item) => item.status === 'accepted')) {
        const replay = await pushOperations(store, userId, deviceId, tenantId, items);
        return { tenantId, ...replay };
      }
      return { __httpStatus: 202, code: 'SYNC_REVIEW_REQUIRED', tenantId, pending: held.filter((item) => item.status === 'pending').map((item) => item.operationId), message: 'Gecikmiş işlemler korunup işletme sahibi incelemesine alındı.' };
    }
    const { accepted, lastSeq } = await pushOperations(store, userId, deviceId, tenantId, items);
    return { tenantId, accepted, lastSeq };
  }));

  app.get(`${BASE}/pull`, (context) => respond(context, async () => {
    const { userId, deviceId } = await authorize(context, keys, devices, 'read');
    const after = readNumber(context.req.query('after'), 0, Number.MAX_SAFE_INTEGER, 'after');
    const limit = readLimit(context.req.query('limit'), LIMITS.pullDefault, LIMITS.pullMax);
    return pullOperations(store, userId, deviceId, after, limit);
  }));

  app.get(`${BASE}/snapshot`, (context) => respond(context, async () => {
    const { userId, deviceId } = await authorize(context, keys, devices, 'read');
    const asOfText = context.req.query('asOf');
    const asOf = asOfText === undefined ? null : readNumber(asOfText, 0, Number.MAX_SAFE_INTEGER, 'asOf');
    const cursor = readCursor(context.req.query('cursor'));
    if (cursor && asOf === null) throw new SyncError(422, 'INVALID_QUERY', 'Sonraki sayfa asOf ile istenir.', { field: 'asOf' });
    const limit = readLimit(context.req.query('limit'), LIMITS.snapshotDefault, LIMITS.snapshotMax);
    const page = await snapshotPage(store, userId, deviceId, asOf, cursor, limit);
    const next = page.next ? Buffer.from(JSON.stringify([page.next.table, page.next.rowKey])).toString('base64url') : null;
    return { ...page, next };
  }));

  app.post(`${BASE}/release`, (context) => respond(context, async () => {
    const { userId, deviceId } = await authorize(context, keys, devices, 'write');
    const data = await readJson(context);
    const body = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const { tenantId, originDeviceId, lastOperationId, operationCount } = body;
    if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId) ||
        typeof originDeviceId !== 'string' || !OPERATION_ID.test(originDeviceId) ||
        !(lastOperationId === null || (typeof lastOperationId === 'string' && OPERATION_ID.test(lastOperationId))) ||
        typeof operationCount !== 'number' || !Number.isSafeInteger(operationCount) || operationCount < 0) {
      throw new SyncError(422, 'INVALID_RELEASE', 'Çıkış bilgisi geçersiz.');
    }
    return releaseDevice(store, userId, deviceId, { tenantId, originDeviceId, lastOperationId, operationCount });
  }));

  // Yeni akışta kiracı yolu açıkça taşınır; üyelik her istekte hesap veritabanından doğrulanır.
  // Eski tek-kiracı uçları geriye uyumluluk için ayrı kalır.
  const scopedAccess = async (context: Context, tenantId: string, need: Need) => {
    if (!accountDb) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const bearer = /^Bearer (\S+)$/.exec(context.req.header('authorization') ?? '')?.[1] ?? '';
    const owner = await keys.find(bearer);
    if (!owner || !owner.emailVerified) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const membership = await accountDb.collection<{ role: string; status: string }>('tenant_membership').findOne({
      userId: owner.id, tenantId, role: 'OWNER', status: 'active',
    });
    if (!membership) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    return authorize(context, keys, devices, need, tenantId);
  };
  const scoped = `${BASE}/tenants/:tenantId`;
  app.use(`${scoped}/push`, bodyLimit({ maxSize: LIMITS.maxBodyBytes, onError: tooLarge }));
  app.use(`${scoped}/release`, bodyLimit({ maxSize: 4096, onError: tooLarge }));
  app.post(`${scoped}/push`, (context) => respond(context, async () => {
    const tenantId = context.req.param('tenantId');
    if (!TENANT_ID.test(tenantId)) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const { userId, deviceId, assessment } = await scopedAccess(context, tenantId, 'write');
    const data = await readJson(context);
    const raw = data && typeof data === 'object' && 'operations' in data ? data.operations : undefined;
    if (!Array.isArray(raw) || raw.length === 0) throw new SyncError(422, 'INVALID_OPERATION', 'İşlem listesi boş veya geçersiz.');
    if (raw.length > LIMITS.maxOperations) throw new SyncError(413, 'TOO_MANY_OPERATIONS', 'Bir gönderimde en çok 500 işlem olabilir.');
    const items = raw.map((operation, index) => parseOperation(operation, index, tenantId));
    const expiry = assessment.expiresAt;
    if (assessment.standing === 'expired' && (expiry === null || items.some(({ operation }) => operation.deviceId !== deviceId))) {
      throw new SyncError(403, 'NEW_OPERATION_AFTER_EXPIRY', 'Lisans bittikten sonra oluşturulan işlem gönderilemez.');
    }
    if (new Set(items.map((item) => item.operation.operationId)).size !== items.length) throw new SyncError(422, 'DUPLICATE_OPERATION', 'Aynı işlem bir gönderimde iki kez var.');
    if (items.reduce((total, item) => total + item.changes.length, 0) > LIMITS.maxChanges) throw new SyncError(413, 'TOO_MANY_CHANGES', 'Bir gönderimde en çok 10000 satır değişikliği olabilir.');
    if (assessment.standing === 'expired') {
      const held = await holdExpiredOperations(store, userId, deviceId, tenantId, items, true);
      if (held.every((item) => item.status === 'accepted')) {
        const replay = await pushOperations(store, userId, deviceId, tenantId, items, true);
        return { tenantId, ...replay };
      }
      return { __httpStatus: 202, code: 'SYNC_REVIEW_REQUIRED', tenantId, pending: held.filter((item) => item.status === 'pending').map((item) => item.operationId), message: 'Gecikmiş işlemler korunup işletme sahibi incelemesine alındı.' };
    }
    const { accepted, lastSeq } = await pushOperations(store, userId, deviceId, tenantId, items, true);
    return { tenantId, accepted, lastSeq };
  }));
  app.get(`${scoped}/pull`, (context) => respond(context, async () => {
    const tenantId = context.req.param('tenantId');
    if (!TENANT_ID.test(tenantId)) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const { userId, deviceId } = await scopedAccess(context, tenantId, 'read');
    return pullOperations(store, userId, deviceId, readNumber(context.req.query('after'), 0, Number.MAX_SAFE_INTEGER, 'after'),
      readLimit(context.req.query('limit'), LIMITS.pullDefault, LIMITS.pullMax), tenantId);
  }));
  app.get(`${scoped}/snapshot`, (context) => respond(context, async () => {
    const tenantId = context.req.param('tenantId');
    if (!TENANT_ID.test(tenantId)) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const { userId, deviceId } = await scopedAccess(context, tenantId, 'read');
    const asOfText = context.req.query('asOf');
    const asOf = asOfText === undefined ? null : readNumber(asOfText, 0, Number.MAX_SAFE_INTEGER, 'asOf');
    const cursor = readCursor(context.req.query('cursor'));
    if (cursor && asOf === null) throw new SyncError(422, 'INVALID_QUERY', 'Sonraki sayfa asOf ile istenir.', { field: 'asOf' });
    const page = await snapshotPage(store, userId, deviceId, asOf, cursor,
      readLimit(context.req.query('limit'), LIMITS.snapshotDefault, LIMITS.snapshotMax), tenantId);
    const next = page.next ? Buffer.from(JSON.stringify([page.next.table, page.next.rowKey])).toString('base64url') : null;
    return { ...page, next };
  }));
  app.post(`${scoped}/release`, (context) => respond(context, async () => {
    const tenantId = context.req.param('tenantId');
    if (!TENANT_ID.test(tenantId)) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
    const { userId, deviceId } = await scopedAccess(context, tenantId, 'write');
    const data = await readJson(context);
    const body = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const { originDeviceId, lastOperationId, operationCount } = body;
    if (body.tenantId !== tenantId || typeof originDeviceId !== 'string' || !OPERATION_ID.test(originDeviceId) ||
        !(lastOperationId === null || (typeof lastOperationId === 'string' && OPERATION_ID.test(lastOperationId))) ||
        typeof operationCount !== 'number' || !Number.isSafeInteger(operationCount) || operationCount < 0) {
      throw new SyncError(422, 'INVALID_RELEASE', 'Çıkış bilgisi geçersiz.');
    }
    return releaseDevice(store, userId, deviceId, { tenantId, originDeviceId, lastOperationId, operationCount }, true);
  }));

  // Gecikmiş çevrimdışı kayıtları yalnız ilgili işletmenin doğrulanmış OWNER'ı uzlaştırabilir.
  if (accountDb && auth) {
    const reviewPath = '/v1/tenants/:tenantId/sync/quarantine';
    const ownerFor = async (context: Context) => {
      const session = await auth.api.getSession({ headers: context.req.raw.headers });
      const tenantId = context.req.param('tenantId');
      if (!session || !session.user.emailVerified || typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
      const membership = await accountDb.collection('tenant_membership').findOne({ userId: session.user.id, tenantId, role: 'OWNER', status: 'active' });
      if (!membership) throw new SyncError(404, 'NOT_FOUND', 'İşletme bulunamadı.');
      return { userId: session.user.id, tenantId };
    };
    app.get(reviewPath, (context) => respond(context, async () => {
      const { tenantId } = await ownerFor(context);
      const pending = await pendingQuarantinedOperations(store.db, tenantId);
      return { tenantId, pending: pending.map(({ operation_id, device_id, operation, changes, received_at }) => ({
        operationId: operation_id,
        deviceId: device_id,
        operationSummary: `${operation.op.domain} · ${changes.length} değişiklik · ${[...new Set(changes.map(({ table }) => table))].slice(0, 3).join(', ') || 'satır değişikliği yok'}`,
        reportedCreatedAt: operation.createdAt,
        receivedAt: received_at.toISOString(),
        waitingReason: 'Lisans süresi dolduktan sonra ulaştı. createdAt cihazdan geldiği için kayıt otomatik uygulanmadı.',
      })) };
    }));
    app.post(`${reviewPath}/:operationId/resolve`, (context) => respond(context, async () => {
      const { userId, tenantId } = await ownerFor(context);
      const operationId = context.req.param('operationId');
      if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) throw new SyncError(404, 'NOT_FOUND', 'Bekletilen işlem bulunamadı.');
      const body = await readJson(context);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyncError(422, 'INVALID_RESOLUTION', 'Karar geçersiz.');
      const decision = (body as Record<string, unknown>).decision;
      const reason = (body as Record<string, unknown>).reason;
      if ((decision !== 'accept' && decision !== 'reject') || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300 || Object.keys(body).sort().join(',') !== 'decision,reason') {
        throw new SyncError(422, 'INVALID_RESOLUTION', 'Karar ve 3–300 karakter gerekçe gerekli.');
      }
      const held = await store.db.collection<{ device_id: string; status: string }>('sync_quarantine').findOne({ tenant_id: tenantId, operation_id: operationId });
      if (decision !== 'accept' || held?.status !== 'pending') {
        try {
          return await resolveQuarantinedOperation(store, userId, tenantId, operationId, decision, userId, reason.trim());
        } finally {
          if (decision === 'reject' && held?.status === 'pending') await devices.releaseReviewLock(userId, tenantId, held.device_id, operationId);
        }
      }
      if (!held) throw new SyncError(404, 'NOT_FOUND', 'Bekletilen işlem bulunamadı.');
      const lock = await devices.lockForReview(userId, tenantId, held.device_id, operationId);
      if (lock === 'revoked') throw new SyncError(403, 'DEVICE_REVOKED', 'İptal edilmiş cihazın kaydı uzlaştırılamaz.');
      if (lock === 'blocked') throw new SyncError(403, 'LICENSE_BLOCKED', 'Engellenmiş cihazın kaydı uzlaştırılamaz.');
      if (lock === 'inactive') throw new SyncError(403, 'LICENSE_INACTIVE', 'Cihazın lisans durumu doğrulanamadı.');
      if (lock === 'busy') throw new SyncError(409, 'DEVICE_REVIEW_IN_PROGRESS', 'Aynı cihaz için başka bir karar işlemi sürüyor.');
      try {
        return await resolveQuarantinedOperation(store, userId, tenantId, operationId, decision, userId, reason.trim());
      } finally {
        await devices.releaseReviewLock(userId, tenantId, held.device_id, operationId);
      }
    }));
  }
}
