import { generateKeyPairSync } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mongoLicenseKeys, mountDesktopLicense, type LicenseKeys } from './desktopLicense.js';
import { createAuth } from './lib/auth.js';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceFixtures.js';
import { ulid } from './lib/prefixedId.js';
import { signingKey } from './license.js';
import { removeUserData } from './lib/mongo.js';
import { licenseActive, mongoDeviceLicenses, type DeviceLicenses } from './sync/deviceLicenses.js';
import { mountCloudSync } from './sync/routes.js';
import { resolveQuarantinedOperation } from './sync/store.js';
import { startTestDatabases, type TestDatabases } from './testDb.js';

const SITE = 'http://localhost:3000';
const DEVICE = 'dev_0123456789';
let db: TestDatabases;
let app: Hono;
let keys: LicenseKeys;
let devices: DeviceLicenses;
let auth: ReturnType<typeof createAuth>;
const AUTH_SECRET = 'test-secret-test-secret-test-secret';

beforeAll(async () => {
  db = await startTestDatabases();
  auth = createAuth({ databases: db, secret: AUTH_SECRET, siteUrl: SITE, allowedOrigins: [SITE], sendMail: async () => {} });
  keys = mongoLicenseKeys(db.account);
  devices = mongoDeviceLicenses(db.account);
  app = new Hono();
  app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw));
  const { privateKey } = generateKeyPairSync('ed25519');
  mountDesktopLicense(app, auth, keys, SITE, { origin: 'http://127.0.0.1:3600', token: 'labs' },
    signingKey(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')), devices);
  mountCloudSync(app, { db: db.business, client: db.businessClient }, keys, devices, db.account, auth);
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
});

async function account(email: string, device = DEVICE, validUntil: string | null = '2099-12-31') {
  const id = `usr_${ulid()}`;
  await db.account.collection<{ _id: string; name: string; email: string; emailVerified: boolean; createdAt: Date; updatedAt: Date }>('user').insertOne({ _id: id, name: 'Sahip', email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  const key = await keys.create(id);
  if (validUntil) await devices.record(id, device, { state: 'active', validUntil, blocked: false, hasPlan: true });
  return { id, key, email };
}

async function ownerSession(owner: { id: string; email: string }) {
  const password = 'Review-test-password-2026!';
  await db.account.collection<{ _id: string; userId: string; accountId: string; providerId: string; password: string; createdAt: Date; updatedAt: Date }>('account').insertOne({
    _id: `acc_${owner.id.slice(4)}`, userId: owner.id, accountId: owner.id,
    providerId: 'credential', password: await hash(password), createdAt: new Date(), updatedAt: new Date(),
  });
  const response = await app.request('/api/auth/sign-in/email', {
    method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

let counter = 0;
interface Change { table: string; action: string; key: Record<string, unknown> | null; row: Record<string, unknown> | null }
function changesOp(tenantId: string, changes: Change[], extra: Record<string, unknown> = {}) {
  counter += 1;
  return {
    operationId: `op_${String(counter).padStart(8, '0')}`,
    tenantId,
    deviceId: 'dev_lan_a',
    actorId: 'SYSTEM',
    actorRole: 'System',
    intentSha256: 'a'.repeat(64),
    op: { domain: 'CHANGES', body: { base_state: 0, changes } },
    createdAt: '2026-11-05T10:00:00+00:00',
    ...extra,
  };
}
const insert = (table: string, row: Record<string, unknown>): Change => ({ table, action: 'I', key: { id: row.id }, row });

function call(path: string, key: string, init: { body?: unknown; device?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'x-device-id': init.device ?? DEVICE };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(`/api/desktop/sync${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
}
const push = (key: string, operations: unknown[], device?: string) => call('/push', key, { body: { operations }, device });
interface Reply {
  [field: string]: unknown;
  operations: { seq: number; tenantId: string }[];
  rows: { key: { id: string } }[];
  next: string | null;
  asOfSeq: number;
}
const json = async (response: Response) => (await response.json()) as Reply;

describe('kimlik', () => {
  it('geçersiz, iptal edilen ve sahibi silinen anahtarı 401 ile reddeder', async () => {
    const owner = await account('a@example.test');
    expect((await call('/pull', 'lk_' + 'x'.repeat(43))).status).toBe(401);
    expect((await call('/pull', owner.key)).status).toBe(200);
    await db.account.collection('desktop_license_key').deleteMany({ userId: owner.id });
    expect(await json(await call('/pull', owner.key))).toMatchObject({ code: 'INVALID_KEY' });
    const other = await account('b@example.test');
    await db.account.collection<{ _id: string }>('user').deleteOne({ _id: other.id });
    expect((await push(other.key, [changesOp('tnt_a', [])])).status).toBe(401);
  });

  it('cihaz kimliği ve lisansı ister; süresi dolan kasa gönderebilir ama okuyamaz', async () => {
    const owner = await account('a@example.test');
    expect((await call('/pull', owner.key, { device: 'x' })).status).toBe(400);
    expect(await json(await call('/pull', owner.key, { device: 'dev_unknown01' }))).toMatchObject({ code: 'DEVICE_NOT_LICENSED' });
    await devices.record(owner.id, DEVICE, { state: 'active', validUntil: '2020-01-01', blocked: false, hasPlan: true });
    expect(await json(await call('/snapshot', owner.key))).toMatchObject({ code: 'LICENSE_INACTIVE' });
    const oldOperation = { ...changesOp('tnt_a', [insert('products', { id: 'prd_backdated', tenant_id: 'tnt_a', price_cents: 12500 })]), deviceId: DEVICE, createdAt: '2019-12-31T20:59:59Z' };
    const held = await push(owner.key, [oldOperation]);
    expect(held.status).toBe(202);
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(0);
    expect(await db.business.collection('sync_row').countDocuments()).toBe(0);
    expect(await db.business.collection('sync_quarantine').countDocuments({ tenant_id: 'tnt_a', operation_id: oldOperation.operationId, status: 'pending' })).toBe(1);
    expect(await db.business.collection('sync_row').findOne({ tenant_id: 'tnt_a', table_name: 'products' })).toBeNull();
    expect((await push(owner.key, [oldOperation])).status).toBe(202);
    expect(await db.business.collection('sync_quarantine').countDocuments({ tenant_id: 'tnt_a' })).toBe(1);
    const newOperation = { ...changesOp('tnt_a', [insert('products', { id: 'prd_forged_time', tenant_id: 'tnt_a', price_cents: 9900 })]), deviceId: DEVICE, createdAt: '2019-12-31T20:59:59Z' };
    const backdatedNew = await push(owner.key, [newOperation]);
    expect(backdatedNew.status).toBe(202);
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: 'tnt_a' })).toBe(0);
    expect(await db.business.collection('sync_quarantine').countDocuments({ tenant_id: 'tnt_a', status: 'pending' })).toBe(2);
    await devices.record(owner.id, DEVICE, { state: 'active', validUntil: '2099-12-31', blocked: false, hasPlan: true });
    expect(await json(await push(owner.key, [oldOperation]))).toMatchObject({ code: 'OPERATION_PENDING_REVIEW' });
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: 'tnt_a' })).toBe(0);
    const business = { db: db.business, client: db.businessClient };
    const reconciled = await resolveQuarantinedOperation(business, owner.id, 'tnt_a', oldOperation.operationId, 'accept', owner.id, 'Kayıt yerel sırayla doğrulandı');
    expect(reconciled).toMatchObject({ status: 'accepted', accepted: [{ duplicate: false, seq: 1 }] });
    const retriedResolution = await resolveQuarantinedOperation(business, owner.id, 'tnt_a', oldOperation.operationId, 'accept', owner.id, 'Tekrar');
    expect(retriedResolution).toMatchObject({ status: 'accepted', accepted: [{ duplicate: true, seq: 1 }] });
    await expect(resolveQuarantinedOperation(business, owner.id, 'tnt_a', oldOperation.operationId, 'reject', owner.id, 'Farklı karar'))
      .rejects.toMatchObject({ code: 'OPERATION_ALREADY_ACCEPTED' });
    expect(await db.business.collection('sync_quarantine_decision').countDocuments({ tenant_id: 'tnt_a', operation_id: oldOperation.operationId })).toBe(1);
    expect(await db.business.collection('sync_operation').countDocuments({ tenant_id: 'tnt_a' })).toBe(1);
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: 'tnt_a' })).toBe(1);
    await devices.record(owner.id, DEVICE, { state: 'revoked', validUntil: null, blocked: false, hasPlan: false });
    expect((await call('/pull', owner.key)).status).toBe(403);
    expect((await push(owner.key, [oldOperation])).status).toBe(403);
  });

  it('iptal edilmiş legacy ve tenant cihazları push ile release erişimini reddeder', async () => {
    const owner = await account('revoked@example.test', DEVICE, null);
    await devices.record(owner.id, DEVICE, { state: 'revoked', validUntil: null, blocked: false, hasPlan: false });
    const legacyPush = await push(owner.key, [changesOp('tnt_a', [])]);
    expect(legacyPush.status).toBe(403);
    expect(await json(legacyPush)).toMatchObject({ code: 'DEVICE_REVOKED' });
    const legacyRelease = await call('/release', owner.key, {
      body: { tenantId: 'tnt_a', originDeviceId: 'dev_lan_a', lastOperationId: null, operationCount: 0 },
    });
    expect(legacyRelease.status).toBe(403);
    expect(await json(legacyRelease)).toMatchObject({ code: 'DEVICE_REVOKED' });
    await devices.record(owner.id, DEVICE, { state: 'active', validUntil: '2099-12-31', blocked: true, hasPlan: true });
    expect(await json(await push(owner.key, [changesOp('tnt_a', [])]))).toMatchObject({ code: 'LICENSE_BLOCKED' });
    expect(await json(await call('/release', owner.key, {
      body: { tenantId: 'tnt_a', originDeviceId: 'dev_lan_a', lastOperationId: null, operationCount: 0 },
    }))).toMatchObject({ code: 'LICENSE_BLOCKED' });

    const tenantId = ACCEPTANCE_CONTRACT_IDS.TEST_A.tenantId;
    await db.account.collection('tenant_membership').insertOne({ userId: owner.id, tenantId, role: 'OWNER', status: 'active' });
    const tenantDevice = 'dev_revoked01';
    await devices.recordTenant(owner.id, tenantId, tenantDevice, { state: 'revoked', validUntil: null, blocked: true, hasPlan: false });
    const scoped = (path: string, body: unknown) => app.request('/api/desktop/sync/tenants/' + tenantId + '/' + path, {
      method: 'POST', headers: { authorization: 'Bearer ' + owner.key, 'x-device-id': tenantDevice, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const scopedPush = await scoped('push', { operations: [changesOp(tenantId, [])] });
    expect(scopedPush.status).toBe(403);
    expect(await json(scopedPush)).toMatchObject({ code: 'DEVICE_REVOKED' });
    const scopedRelease = await scoped('release', {
      tenantId, originDeviceId: 'dev_lan_a', lastOperationId: null, operationCount: 0,
    });
    expect(scopedRelease.status).toBe(403);
    expect(await json(scopedRelease)).toMatchObject({ code: 'DEVICE_REVOKED' });
    await devices.recordTenant(owner.id, tenantId, tenantDevice, {
      state: 'active', validUntil: '2099-12-31', paidUntil: '2099-12-31T21:00:00Z',
      offlineUntil: '2099-12-31T20:00:00Z', blocked: true, hasPlan: true,
    });
    expect(await json(await scoped('push', { operations: [changesOp(tenantId, [])] })))
      .toMatchObject({ code: 'LICENSE_BLOCKED' });
    expect(await json(await scoped('release', {
      tenantId, originDeviceId: 'dev_lan_a', lastOperationId: null, operationCount: 0,
    }))).toMatchObject({ code: 'LICENSE_BLOCKED' });
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(0);
  });

  it('lisans belgesi alınınca cihazı eşitlemeye açar, panelden kaldırılınca okumayı kapatır', async () => {
    const owner = await account('a@example.test', DEVICE, null);
    const license = () => app.request('/api/desktop/license', { headers: { authorization: `Bearer ${owner.key}`, 'x-device-id': DEVICE } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      valid_until: '2099-01-31', blocked: false, device: 'active', package: { name: 'Temel', features: [], device_limit: 1 },
    })));
    try {
      expect((await call('/pull', owner.key)).status).toBe(403);
      expect((await license()).status).toBe(200);
      expect((await call('/pull', owner.key)).status).toBe(200);
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ valid_until: '2099-01-31', blocked: false, device: 'revoked' })));
      expect((await license()).status).toBe(403);
      expect(await json(await call('/pull', owner.key))).toMatchObject({ code: 'DEVICE_REVOKED' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('gönderim', () => {
  it('aynı işlemi aynı sırayla kabul eder, farklı içeriği çakışma sayar', async () => {
    const owner = await account('a@example.test');
    const first = changesOp('tnt_a', [insert('products', { id: 'prd_1', tenant_id: 'tnt_a', price_cents: 1250 })]);
    const second = changesOp('tnt_a', [insert('products', { id: 'prd_2', tenant_id: 'tnt_a', price_cents: 900 })]);
    const response = await push(owner.key, [first, second]);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      tenantId: 'tnt_a', lastSeq: 2,
      accepted: [{ operationId: first.operationId, seq: 1, duplicate: false }, { operationId: second.operationId, seq: 2, duplicate: false }],
    });
    // Anahtar sırası farklı gelse de içerik aynıdır.
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    expect(await json(await push(owner.key, [reordered]))).toMatchObject({ accepted: [{ seq: 1, duplicate: true }], lastSeq: 2 });
    const changed = { ...first, op: { domain: 'CHANGES', body: { base_state: 0, changes: [insert('products', { id: 'prd_1', tenant_id: 'tnt_a', price_cents: 1 })] } } };
    const conflict = await push(owner.key, [changesOp('tnt_a', []), changed]);
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toMatchObject({ code: 'OPERATION_CONFLICT', operationId: first.operationId });
    // Çakışan gönderimin geri kalanı da yazılmaz.
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(2);
    const row = await db.business.collection('sync_row').findOne({ row_key: '[["id","prd_1"]]' });
    expect(row?.data).toEqual({ id: 'prd_1', tenant_id: 'tnt_a', price_cents: 1250 });
  });

  it('hesabı ilk kiracıya bağlar, başka kiracıyı ve başka hesabın kiracısını reddeder', async () => {
    const owner = await account('a@example.test');
    const other = await account('b@example.test');
    expect((await push(owner.key, [changesOp('tnt_a', [])])).status).toBe(200);
    expect(await json(await push(owner.key, [changesOp('tnt_b', [])]))).toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(await json(await push(other.key, [changesOp('tnt_a', [])]))).toMatchObject({ code: 'TENANT_TAKEN' });
    expect(await json(await push(owner.key, [changesOp('tnt_a', []), changesOp('tnt_b', [])]))).toMatchObject({ code: 'TENANT_MISMATCH', index: 1 });
    const foreignRow = changesOp('tnt_a', [insert('orders', { id: 'ord_1', tenant_id: 'tnt_b' })]);
    expect((await push(owner.key, [foreignRow])).status).toBe(403);
  });

  it('silmeyi iz olarak işler, anahtar değiştiren güncellemede eski satırı siler', async () => {
    const owner = await account('a@example.test');
    await push(owner.key, [changesOp('tnt_a', [
      insert('orders', { id: 'ord_1', tenant_id: 'tnt_a', total_cents: 500 }),
      { table: 'product_groups', action: 'I', key: { product_id: 'prd_1', group_id: 'grp_1' }, row: { product_id: 'prd_1', group_id: 'grp_1' } },
    ])]);
    await push(owner.key, [changesOp('tnt_a', [
      { table: 'orders', action: 'D', key: { id: 'ord_1' }, row: null },
      { table: 'product_groups', action: 'U', key: { group_id: 'grp_1', product_id: 'prd_1' }, row: { product_id: 'prd_1', group_id: 'grp_2' } },
    ])]);
    const rows = (await db.business.collection('sync_row').find({}).sort({ table_name: 1, row_key: 1 }).toArray())
      .map(({ table_name, row_key, deleted, data, last_seq }) => ({ table_name, row_key, deleted, data, seq: last_seq }));
    expect(rows).toEqual([
      { table_name: 'orders', row_key: '[["id","ord_1"]]', deleted: true, data: null, seq: 2 },
      { table_name: 'product_groups', row_key: '[["group_id","grp_1"],["product_id","prd_1"]]', deleted: true, data: null, seq: 2 },
      { table_name: 'product_groups', row_key: '[["group_id","grp_2"],["product_id","prd_1"]]', deleted: false, data: { product_id: 'prd_1', group_id: 'grp_2' }, seq: 2 },
    ]);
  });

  it('yerel tabloları satır durumuna yazmaz, eşitleme tablolarını ve bozuk değişikliği reddeder', async () => {
    const owner = await account('a@example.test');
    await push(owner.key, [changesOp('tnt_a', [insert('outbox', { id: 'out_1' })])]);
    expect(await db.business.collection('sync_row').countDocuments()).toBe(0);
    const bad: Change[] = [
      insert('sync_operations', { id: 'x' }),
      insert('Orders; DROP TABLE x', { id: 'x' }),
      { table: 'orders', action: 'I', key: null, row: { id: 'ord_1' } },
      { table: 'orders', action: 'I', key: { id: 'ord_2' }, row: { id: 'ord_1' } },
      { table: 'orders', action: 'U', key: { id: 'ord_1' }, row: { total_cents: 1 } },
      { table: 'orders', action: 'X', key: { id: 'ord_1' }, row: null },
      { table: 'orders', action: 'I', key: { id: 'ord_1' }, row: { id: 'ord_1', 'bad name': 1 } },
    ];
    for (const change of bad) {
      expect(await json(await push(owner.key, [changesOp('tnt_a', [change])]))).toMatchObject({ code: 'INVALID_OPERATION' });
    }
  });

  it('kayıpsız saklanamayan sayı ve metni, sınır aşan gönderimi reddeder', async () => {
    const owner = await account('a@example.test');
    const unsafe = JSON.stringify({ operations: [changesOp('tnt_a', [insert('orders', { id: 'ord_1', total_cents: 0 })])] })
      .replace('"total_cents":0', '"total_cents":9007199254740993');
    expect((await call('/push', owner.key, { body: unsafe })).status).toBe(422);
    expect((await push(owner.key, [changesOp('tnt_a', [insert('orders', { id: 'ord_1', note: 'a\u0000b' })])])).status).toBe(422);
    const many = Array.from({ length: 501 }, () => changesOp('tnt_a', []));
    expect(await json(await push(owner.key, many))).toMatchObject({ code: 'TOO_MANY_OPERATIONS' });
    const huge = [changesOp('tnt_a', [insert('orders', { id: 'ord_1', note: 'x'.repeat(4 * 1024 * 1024) })])];
    const tooLarge = await push(owner.key, huge);
    expect(tooLarge.status).toBe(413);
    expect(await json(tooLarge)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    const twice = changesOp('tnt_a', []);
    expect(await json(await push(owner.key, [twice, twice]))).toMatchObject({ code: 'DUPLICATE_OPERATION' });
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(0);
  });

  it('hesap silinince işletme verisi ve anahtarlar düşer', async () => {
    const owner = await account('a@example.test');
    await push(owner.key, [changesOp('tnt_a', [insert('orders', { id: 'ord_1' })])]);
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(1);
    await removeUserData(db, owner.id);
    expect(await db.business.collection('sync_tenant').countDocuments()).toBe(0);
    expect(await db.account.collection('desktop_license_key').countDocuments()).toBe(0);
    expect(await db.business.collection('sync_operation').countDocuments()).toBe(0);
    expect(await db.business.collection('sync_row').countDocuments()).toBe(0);
  });
});

describe('çekme ve anlık görüntü', () => {
  it('işlemleri sırayla verir, kendi gönderdiğini atlar, sayfalar ve ileri imleci reddeder', async () => {
    const owner = await account('a@example.test');
    await devices.record(owner.id, 'dev_second01', { state: 'active', validUntil: '2099-12-31', blocked: false, hasPlan: true });
    await push(owner.key, [changesOp('tnt_a', []), changesOp('tnt_a', [])]);
    await push(owner.key, [changesOp('tnt_a', []), { ...changesOp('tnt_a', []), op: { domain: 'NOOP' } }], 'dev_second01');
    const own = await json(await call('/pull?after=0', owner.key));
    expect(own.operations.map((op: { seq: number }) => op.seq)).toEqual([3, 4]);
    expect(own).toMatchObject({ nextAfter: 4, hasMore: false, lastSeq: 4 });
    expect(own.operations[1]).toMatchObject({ tenantId: 'tnt_a', op: { domain: 'NOOP' } });
    const page = await json(await call('/pull?after=0&limit=3', owner.key, { device: 'dev_second01' }));
    expect(page).toMatchObject({ nextAfter: 3, hasMore: true });
    expect(page.operations.map((op: { seq: number }) => op.seq)).toEqual([1, 2]);
    expect(await json(await call('/pull?after=3', owner.key, { device: 'dev_second01' }))).toMatchObject({ operations: [], nextAfter: 4, hasMore: false });
    expect(await json(await call('/pull?after=9', owner.key))).toMatchObject({ code: 'CURSOR_AHEAD' });
    expect((await call('/pull?limit=0', owner.key)).status).toBe(422);
    const cursor = await db.business.collection('sync_device_cursor').findOne({ device_id: 'dev_second01' });
    expect(cursor?.pulled_seq).toBe(3);
  });

  it('başka kiracının işlemini ve satırını asla döndürmez', async () => {
    const first = await account('a@example.test');
    const second = await account('b@example.test');
    await push(first.key, [changesOp('tnt_a', [insert('orders', { id: 'ord_1', tenant_id: 'tnt_a' })])]);
    expect(await json(await call('/pull', second.key))).toEqual({ tenantId: null, operations: [], nextAfter: 0, hasMore: false, lastSeq: 0 });
    expect(await json(await call('/snapshot', second.key))).toEqual({ tenantId: null, asOfSeq: 0, rows: [], next: null });
    await push(second.key, [changesOp('tnt_b', [insert('orders', { id: 'ord_1', tenant_id: 'tnt_b' })])]);
    await devices.record(second.id, 'dev_second01', { state: 'active', validUntil: '2099-12-31', blocked: false, hasPlan: true });
    const pulled = await json(await call('/pull', second.key, { device: 'dev_second01' }));
    expect(pulled.operations.map((op) => op.tenantId)).toEqual(['tnt_b']);
    // Kimlik başka hesabın anahtarıyla aynı olsa da cihaz lisansı hesaba göredir.
    expect((await call('/pull', first.key, { device: 'dev_second01' })).status).toBe(403);
    const snapshot = await json(await call('/snapshot', second.key));
    expect(snapshot).toMatchObject({ tenantId: 'tnt_b', rows: [{ table: 'orders', row: { tenant_id: 'tnt_b' } }] });
    expect(snapshot.rows).toHaveLength(1);
  });

  it('anlık görüntüyü sabit sırada sayfalar, sonradan değişen satırı pull ile bırakır', async () => {
    const owner = await account('a@example.test');
    await push(owner.key, [changesOp('tnt_a', ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => insert('products', { id, tenant_id: 'tnt_a' })))]);
    const first = await json(await call('/snapshot?limit=2', owner.key));
    expect(first).toMatchObject({ tenantId: 'tnt_a', asOfSeq: 1 });
    expect(first.rows.map((row: { key: { id: string } }) => row.key.id)).toEqual(['p1', 'p2']);
    // Sayfalar arasında gelen değişiklik sabitlenen sıranın ötesindedir.
    await push(owner.key, [changesOp('tnt_a', [
      { table: 'products', action: 'U', key: { id: 'p4' }, row: { id: 'p4', tenant_id: 'tnt_a', name: 'yeni' } },
      { table: 'products', action: 'D', key: { id: 'p1' }, row: null },
      insert('products', { id: 'p0', tenant_id: 'tnt_a' }),
    ])]);
    const seen: string[] = first.rows.map((row: { key: { id: string } }) => row.key.id);
    let next: string | null = first.next;
    while (next) {
      const page = await json(await call(`/snapshot?limit=2&asOf=${first.asOfSeq}&cursor=${next}`, owner.key));
      expect(page.asOfSeq).toBe(1);
      seen.push(...page.rows.map((row: { key: { id: string } }) => row.key.id));
      next = page.next;
    }
    expect(seen).toEqual(['p1', 'p2', 'p3', 'p5']);
    await devices.record(owner.id, 'dev_second01', { state: 'active', validUntil: '2099-12-31', blocked: false, hasPlan: true });
    const tail = await json(await call(`/pull?after=${first.asOfSeq}`, owner.key, { device: 'dev_second01' }));
    expect(tail.operations.map((op) => op.seq)).toEqual([2]);
    expect((await call('/snapshot?cursor=abc', owner.key)).status).toBe(422);
    expect(await json(await call('/snapshot?asOf=99', owner.key))).toMatchObject({ code: 'CURSOR_AHEAD' });
    const fresh = await json(await call('/snapshot', owner.key));
    expect(fresh.rows.map((row: { key: { id: string } }) => row.key.id)).toEqual(['p0', 'p2', 'p3', 'p4', 'p5']);
  });
});

describe('çıkış', () => {
  it('kasanın işlemlerinin tamamı bulutta değilse silmeye izin vermez', async () => {
    const owner = await account('a@example.test');
    const release = (body: Record<string, unknown>) => call('/release', owner.key, { body });
    const claim = { tenantId: 'tnt_a', originDeviceId: 'dev_lan_a', lastOperationId: null, operationCount: 0 };
    expect(await json(await release(claim))).toMatchObject({ safeToWipe: true });
    const ops = [changesOp('tnt_a', []), changesOp('tnt_a', [])];
    await push(owner.key, [ops[0]]);
    const pending = await release({ ...claim, lastOperationId: ops[1].operationId, operationCount: 2 });
    expect(pending.status).toBe(409);
    expect(await json(pending)).toMatchObject({ code: 'PENDING_OPERATIONS', safeToWipe: false, serverCount: 1 });
    expect(await json(await release({ ...claim, tenantId: 'tnt_b', lastOperationId: ops[0].operationId, operationCount: 1 }))).toMatchObject({ code: 'TENANT_MISMATCH' });
    await push(owner.key, ops);
    expect(await json(await release({ ...claim, lastOperationId: ops[1].operationId, operationCount: 2 }))).toEqual({ safeToWipe: true, lastSeq: 2, serverCount: 2 });
    const cursor = await db.business.collection('sync_device_cursor').findOne({ device_id: DEVICE });
    expect(cursor?.released_at).toBeInstanceOf(Date);
    expect((await release({ ...claim, operationCount: -1 })).status).toBe(422);
  });
});

describe('tenant kapsamlı eşitleme', () => {
  it('aynı hesapta iki OWNER işletmesini ayrı sıralar ve üyelik dışını reddeder', async () => {
    const owner = await account('multi@example.test');
    const tenantA = ACCEPTANCE_CONTRACT_IDS.TEST_A.tenantId;
    const tenantB = ACCEPTANCE_CONTRACT_IDS.TEST_B.tenantId;
    await db.account.collection('tenant_membership').insertMany([
      { userId: owner.id, tenantId: tenantA, role: 'OWNER', status: 'active' },
      { userId: owner.id, tenantId: tenantB, role: 'OWNER', status: 'active' },
    ]);
    const activeV2 = { state: 'active', validUntil: '2099-12-31', paidUntil: '2099-12-31T21:00:00Z', offlineUntil: '2099-12-31T20:00:00Z', blocked: false, hasPlan: true } as const;
    await devices.recordTenant(owner.id, tenantA, DEVICE, activeV2);
    const otherDevice = 'dev_sync_alt01';
    await devices.recordTenant(owner.id, tenantB, otherDevice, activeV2);
    const scoped = (tenantId: string, path: string, operations?: unknown[], device?: string) => call(
      `/tenants/${tenantId}/${path}`, owner.key, operations ? { body: { operations }, device } : { device },
    );
    const opA = changesOp(tenantA, [insert('orders', { id: 'ord_a', tenant_id: tenantA })]);
    const opB = changesOp(tenantB, [insert('orders', { id: 'ord_b', tenant_id: tenantB })]);
    expect(await json(await scoped(tenantA, 'push', [opA]))).toMatchObject({ tenantId: tenantA, lastSeq: 1 });
    expect(await json(await scoped(tenantA, 'push', [opA]))).toMatchObject({ accepted: [{ duplicate: true, seq: 1 }], lastSeq: 1 });
    expect(await json(await scoped(tenantB, 'push', [opA], otherDevice))).toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(await json(await scoped(tenantB, 'push', [opB], otherDevice))).toMatchObject({ tenantId: tenantB, lastSeq: 1 });
    expect(await json(await call('/push', owner.key, { body: { operations: [opB] }, device: otherDevice })))
      .toMatchObject({ code: 'DEVICE_NOT_LICENSED' });
    await devices.recordTenant(owner.id, tenantA, 'dev_sync_pull01', activeV2);
    expect(await json(await app.request(`/api/desktop/sync/tenants/${tenantA}/pull?after=0`, {
      headers: { authorization: `Bearer ${owner.key}`, 'x-device-id': 'dev_sync_pull01' },
    }))).toMatchObject({ tenantId: tenantA, operations: [{ tenantId: tenantA }] });
    expect(await json(await scoped(tenantB, 'snapshot', undefined, otherDevice))).toMatchObject({ tenantId: tenantB, rows: [{ row: { id: 'ord_b', tenant_id: tenantB } }] });
    const released = await app.request(`/api/desktop/sync/tenants/${tenantA}/release`, {
      method: 'POST', headers: { authorization: `Bearer ${owner.key}`, 'x-device-id': DEVICE, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: tenantA, originDeviceId: 'dev_lan_a', lastOperationId: opA.operationId, operationCount: 1 }),
    });
    expect(await json(released)).toMatchObject({ safeToWipe: true, serverCount: 1 });
    const foreign = await account('foreign@example.test');
    const denied = await app.request(`/api/desktop/sync/tenants/${tenantA}/pull`, {
      headers: { authorization: `Bearer ${foreign.key}`, 'x-device-id': DEVICE },
    });
    expect(denied.status).toBe(404);
  });
});

describe('OWNER incelemesi', () => {
  it('tenant OWNER listeler, gerekçeyle kabul/red verir ve lisans yenilemesi incelemeyi atlatmaz', async () => {
    const owner = await account('review-owner@example.test');
    const foreign = await account('review-foreign@example.test');
    const tenantId = ACCEPTANCE_CONTRACT_IDS.TEST_A.tenantId;
    await db.account.collection('tenant_membership').insertOne({ userId: owner.id, tenantId, role: 'OWNER', status: 'active' });
    await db.account.collection('tenant_membership').insertOne({ userId: foreign.id, tenantId: ACCEPTANCE_CONTRACT_IDS.TEST_B.tenantId, role: 'OWNER', status: 'active' });
    const expiredV2 = { state: 'active', validUntil: '2026-11-06', paidUntil: '2026-11-06T20:00:00Z', offlineUntil: '2026-11-06T19:00:00Z', blocked: false, hasPlan: true } as const;
    const activeV2 = { state: 'active', validUntil: '2099-12-31', paidUntil: '2099-12-31T21:00:00Z', offlineUntil: '2099-12-31T20:00:00Z', blocked: false, hasPlan: true } as const;
    await devices.recordTenant(owner.id, tenantId, DEVICE, expiredV2);
    const operation = changesOp(tenantId, [insert('products', { id: 'prd_review_accept', tenant_id: tenantId, name: 'İnceleme ürünü' })], { deviceId: DEVICE });
    const rejected = changesOp(tenantId, [insert('products', { id: 'prd_review_reject', tenant_id: tenantId, name: 'Reddedilecek ürün' })], { deviceId: DEVICE });
    const blockedRace = changesOp(tenantId, [insert('products', { id: 'prd_review_block_race', tenant_id: tenantId, name: 'Engel yarışı' })], { deviceId: DEVICE });
    await db.business.collection('sync_tenant').insertOne({ tenant_id: tenantId, user_id: owner.id, last_seq: 0, created_at: new Date(), touched_at: new Date() });
    const delayed = await call(`/tenants/${tenantId}/push`, owner.key, { body: { operations: [operation, rejected, blockedRace] }, device: DEVICE });
    expect(delayed.status).toBe(202);
    await devices.recordTenant(owner.id, tenantId, DEVICE, activeV2);
    const ownerCookie = await ownerSession(owner);
    const foreignCookie = await ownerSession(foreign);
    const list = (cookie: string, tenant = tenantId) => app.request(`/v1/tenants/${tenant}/sync/quarantine`, { headers: { cookie } });
    const pending = await list(ownerCookie);
    expect(pending.status).toBe(200);
    const listed = await pending.json() as { pending: { operationId: string; deviceId: string; operationSummary: string; waitingReason: string }[] };
    expect(listed.pending).toHaveLength(3);
    expect(listed.pending.find((item) => item.operationId === operation.operationId)).toMatchObject({ deviceId: DEVICE, operationSummary: expect.stringContaining('products'), waitingReason: expect.any(String) });
    expect(listed.pending.map(({ operationId }) => operationId)).toContain(rejected.operationId);
    expect(listed.pending.map(({ operationId }) => operationId)).toContain(blockedRace.operationId);
    expect((await list(foreignCookie)).status).toBe(404);
    const renewalBypass = await call(`/tenants/${tenantId}/push`, owner.key, { body: { operations: [operation] }, device: DEVICE });
    expect(renewalBypass.status).toBe(409);
    expect(await json(renewalBypass)).toMatchObject({ code: 'OPERATION_PENDING_REVIEW' });
    const resolve = (operationId: string, decision: 'accept' | 'reject', reason: string) => app.request(
      `/v1/tenants/${tenantId}/sync/quarantine/${operationId}/resolve`,
      { method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ decision, reason }) },
    );
    expect(await devices.lockForReview(owner.id, tenantId, DEVICE, blockedRace.operationId)).toBe('locked');
    const [blockAttempt, acceptDuringBlock] = await Promise.allSettled([
      devices.recordTenant(owner.id, tenantId, DEVICE, { state: 'blocked', validUntil: '2099-12-31', paidUntil: '2099-12-31T20:00:00Z', offlineUntil: '2099-12-31T20:00:00Z', blocked: true, hasPlan: true }),
      resolve(blockedRace.operationId, 'accept', 'Ürün kaydı kontrol edilip kabul edildi'),
    ]);
    expect(blockAttempt.status).toBe('rejected');
    if (blockAttempt.status === 'rejected') expect(blockAttempt.reason).toMatchObject({ message: 'DEVICE_REVIEW_IN_PROGRESS' });
    expect(acceptDuringBlock.status).toBe('fulfilled');
    if (acceptDuringBlock.status === 'fulfilled') expect(acceptDuringBlock.value.status).toBe(200);
    expect((await resolve(operation.operationId, 'accept', 'Ürün kaydı doğrulandı')).status).toBe(200);
    expect((await resolve(rejected.operationId, 'reject', 'Ürün kaydı doğrulanamadı')).status).toBe(200);
    expect(await db.business.collection('sync_operation').countDocuments({ tenant_id: tenantId, operation_id: operation.operationId })).toBe(1);
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: tenantId, row_key: '[["id","prd_review_accept"]]' })).toBe(1);
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: tenantId, row_key: '[["id","prd_review_reject"]]' })).toBe(0);
    await expect((await list(ownerCookie)).json()).resolves.toMatchObject({ pending: [] });
  });
});

describe('Mongo kuralları', () => {
  it('lisans bitiş günü İstanbul gün sonuna ve toleransa kadar geçer', () => {
    const base = { state: 'active', valid_until: '2027-01-31', blocked: false, has_plan: true };
    const dayEnd = Date.parse('2027-02-01T00:00:00+03:00');
    expect(licenseActive(base, dayEnd - 1)).toBe(true);
    expect(licenseActive(base, dayEnd + 72 * 3_600_000 - 1)).toBe(true);
    expect(licenseActive(base, dayEnd + 72 * 3_600_000)).toBe(false);
    expect(licenseActive({ ...base, blocked: true }, dayEnd - 1)).toBe(false);
    expect(licenseActive({ ...base, has_plan: false }, dayEnd - 1)).toBe(false);
    expect(licenseActive({ ...base, valid_until: null }, dayEnd - 1)).toBe(false);
  });

  it('V2 tam zamanlı offlineUntil ve paidUntil sınırlarında gün sonu toleransı uygulamaz', () => {
    const v2 = {
      state: 'active', valid_until: '2027-01-31T12:00:00Z', blocked: false, has_plan: true,
      license_version: 2 as const, paid_until: '2027-01-31T12:00:00Z', offline_until: '2027-01-30T18:00:00Z',
    };
    expect(licenseActive(v2, Date.parse('2027-01-30T17:59:59.999Z'))).toBe(true);
    expect(licenseActive(v2, Date.parse('2027-01-30T18:00:00Z'))).toBe(false);
    const paidBoundary = { ...v2, offline_until: v2.paid_until };
    expect(licenseActive(paidBoundary, Date.parse('2027-01-31T11:59:59.999Z'))).toBe(true);
    expect(licenseActive(paidBoundary, Date.parse('2027-01-31T12:00:00Z'))).toBe(false);
    expect(licenseActive({ ...v2, offline_until: '2027-01-31T12:00:01Z' }, Date.parse(v2.paid_until))).toBe(false);
    expect(licenseActive({ ...v2, paid_until: null }, Date.parse('2027-01-30T17:59:00Z'))).toBe(false);
  });

  it('eşzamanlı gönderimler boşluksuz ve tekil sıra alır', async () => {
    const owner = await account('a@example.test');
    await push(owner.key, [changesOp('tnt_a', [])]);
    const replies = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      push(owner.key, [changesOp('tnt_a', [insert('orders', { id: `ord_${index}` })])])));
    expect(replies.map((reply) => reply.status)).toEqual(Array(8).fill(200));
    const seqs = (await db.business.collection('sync_operation').find({}).sort({ seq: 1 }).toArray()).map((op) => op.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await db.business.collection('sync_tenant').findOne({}))?.last_seq).toBe(9);
  });
});
