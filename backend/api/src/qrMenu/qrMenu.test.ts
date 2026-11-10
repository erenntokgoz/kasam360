import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CONTRACT_IDS } from '../acceptanceIds.js';
import { mongoLicenseKeys } from '../desktopLicense.js';
import { mongoDeviceLicenses } from '../sync/deviceLicenses.js';
import { startTestDatabases, type TestDatabases } from '../testDb.js';
import { labsQrMenuEntitlement } from './entitlement.js';
import { diskMenuMediaStore } from './mediaStore.js';
import { mountQrMenu } from './routes.js';
import { checkSlug } from './slug.js';

const A = ACCEPTANCE_CONTRACT_IDS.TEST_A;
const B = ACCEPTANCE_CONTRACT_IDS.TEST_B;
const SECRET = 's'.repeat(40);
const DEVICE_A = 'dev_01arz3ndektsv4rrffq69g5fa9';
const DEVICE_B = 'dev_01arz3ndektsv4rrffq69g5fb9';

let db: TestDatabases;
let app: Hono;
let mediaDir: string;
let keyA: string;
let keyB: string;
let featureKeys: string[];
let labsDown: boolean;
let clock: number;

beforeAll(async () => {
  db = await startTestDatabases();
  mediaDir = await mkdtemp(join(tmpdir(), 'qrmenu-'));
}, 120_000);
afterAll(async () => {
  await db?.stop();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.reset();
  const now = new Date();
  for (const tenant of [A, B]) {
    await db.account.collection<Record<string, unknown>>('user').insertOne({ _id: tenant.ownerId, name: 'OWNER', email: tenant.email, emailVerified: true, createdAt: now, updatedAt: now } as never);
    await db.account.collection<Record<string, unknown>>('tenant').insertOne({ _id: tenant.tenantId, name: tenant.businessName, country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul', status: 'active', version: 1, createdAt: now } as never);
    await db.account.collection('tenant_membership').insertOne({ userId: tenant.ownerId, tenantId: tenant.tenantId, role: 'OWNER', status: 'active', version: 1, createdAt: now });
  }
  const keys = mongoLicenseKeys(db.account);
  keyA = await keys.create(A.ownerId);
  keyB = await keys.create(B.ownerId);
  const devices = mongoDeviceLicenses(db.account);
  const until = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const active = { state: 'active', validUntil: until, paidUntil: until, offlineUntil: until, blocked: false, hasPlan: true };
  await devices.recordTenant(A.ownerId, A.tenantId, DEVICE_A, active);
  await devices.recordTenant(B.ownerId, B.tenantId, DEVICE_B, active);

  featureKeys = ['feat_qr_menu'];
  labsDown = false;
  clock = Date.now();
  const fetcher = async (input: string | URL | Request) => {
    if (labsDown) return Response.json({ message: 'down' }, { status: 503 });
    const tenantId = /kiracilar\/([^/]+)\/hak/.exec(String(input))?.[1] ?? '';
    return Response.json({
      tenantId, productId: A.productId, status: 'active', source: 'manual', packageId: A.packageId, packageVersion: 1,
      featureKeys, deviceLimit: 1, validFrom: '2026-11-07T00:00:00Z', validUntil: '2099-01-01T00:00:00Z', revision: 1,
    });
  };
  app = new Hono();
  mountQrMenu(app, {
    business: db.business, businessClient: db.businessClient, account: db.account,
    keys, devices, media: diskMenuMediaStore(mediaDir), labsSecret: SECRET,
    entitlement: labsQrMenuEntitlement({ labsOrigin: 'http://127.0.0.1:3600', labsToken: 'test', fetcher, now: () => clock }),
  });
});

const desktopHeaders = (key: string, device: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, 'x-device-id': device, ...extra });

interface TestProduct { id: string; name: string; description: string | null; priceCents: number; categoryId: string; sortOrder: number; imageKey: string | null; active: boolean; inStock: boolean }
interface TestMenu { schema: string; businessName?: string; categories: { id: string; name: string; sortOrder: number }[]; products: TestProduct[] }
const menuBody = (overrides: Partial<TestMenu> = {}): TestMenu => ({
  schema: 'kasam360.qrmenu.v1',
  categories: [{ id: 'cat_b', name: 'Tatlılar', sortOrder: 20 }, { id: 'cat_a', name: 'İçecekler', sortOrder: 10 }],
  products: [
    { id: 'prd_1', name: 'Türk Kahvesi', description: 'Orta şekerli', priceCents: 12500, categoryId: 'cat_a', sortOrder: 10, imageKey: null, active: true, inStock: true },
    { id: 'prd_2', name: 'Baklava', description: null, priceCents: 21050, categoryId: 'cat_b', sortOrder: 10, imageKey: null, active: true, inStock: false },
    { id: 'prd_gizli', name: 'Kapalı Ürün', description: null, priceCents: 100, categoryId: 'cat_b', sortOrder: 20, imageKey: null, active: false, inStock: true },
  ],
  ...overrides,
});

const publish = (body: unknown, key = keyA, device = DEVICE_A, tenant: string = A.tenantId) => app.request(`/api/desktop/tenants/${tenant}/menu`, {
  method: 'PUT', headers: desktopHeaders(key, device, { 'content-type': 'application/json' }), body: JSON.stringify(body),
});

const assign = (tenantId: string, body: unknown, secret = SECRET) => app.request(`/internal/labs/qr-menu/${tenantId}/slug`, {
  method: 'PUT', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** Gerçek WebP başlığı biçimi: RIFF + VP8L; boyut alanı dosya uzunluğuyla tutarlıdır. */
function webp(width: number, height: number, padding = 0) {
  const payload = Buffer.alloc(10 + padding);
  payload[0] = 0x2f;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const chunk = Buffer.concat([Buffer.from('VP8L'), Buffer.alloc(4), payload]);
  chunk.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP'), chunk]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const upload = (bytes: Uint8Array, key = keyA, device = DEVICE_A, tenant: string = A.tenantId, type = 'image/webp') => app.request(`/api/desktop/tenants/${tenant}/menu/images`, {
  method: 'PUT', headers: desktopHeaders(key, device, { 'content-type': type }), body: bytes as BodyInit,
});

describe('QR menü yayınlama', () => {
  it('kimliksiz, başka işletmeye bağlı cihazla ve başka tenant yoluna yazmayı reddeder', async () => {
    expect((await publish(menuBody(), 'lk_gecersiz')).status).toBe(401);
    // A'nın anahtarı ve cihazıyla B işletmesine yazma: cihaz B'ye lisanslı değildir.
    const cross = await publish(menuBody(), keyA, DEVICE_A, B.tenantId);
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ code: 'DEVICE_NOT_LICENSED' });
    // B'nin kendi cihazıyla bile A'ya yazılamaz.
    expect((await publish(menuBody(), keyB, DEVICE_B, A.tenantId)).status).toBe(403);
    expect(await db.business.collection('qr_menu_publication').countDocuments({})).toBe(0);
  });

  it('aynı içerik idempotenttir; sıra farkı sürümü artırmaz, içerik farkı artırır', async () => {
    const first = await publish(menuBody());
    expect(first.status).toBe(200);
    const created = await first.json() as { version: number; changed: boolean; etag: string; slug: null };
    expect(created).toMatchObject({ version: 1, changed: true, slug: null });
    const again = await (await publish(menuBody())).json() as { version: number; changed: boolean; etag: string };
    expect(again).toMatchObject({ version: 1, changed: false, etag: created.etag });
    const shuffled = menuBody({ categories: [...menuBody().categories].reverse(), products: [...menuBody().products].reverse() });
    expect(await (await publish(shuffled)).json()).toMatchObject({ version: 1, changed: false });
    const edited = menuBody();
    edited.products[0]!.priceCents = 13000;
    expect(await (await publish(edited)).json()).toMatchObject({ version: 2, changed: true });
    expect(await db.business.collection('qr_menu_publication').countDocuments({ tenant_id: A.tenantId })).toBe(1);
  });

  it('eşzamanlı ilk yayında tek belge ve tek sürüm kalır', async () => {
    const results = await Promise.all([publish(menuBody()), publish(menuBody()), publish(menuBody())]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(await db.business.collection('qr_menu_publication').countDocuments({ tenant_id: A.tenantId })).toBe(1);
    const stored = await db.business.collection('qr_menu_publication').findOne({ tenant_id: A.tenantId });
    expect(stored?.version).toBe(1);
  });

  it('kuruş tamsayı değilse, kategori yoksa veya bilinmeyen alan varsa reddeder', async () => {
    const floating = menuBody();
    floating.products[0]!.priceCents = 125.5;
    expect((await publish(floating)).status).toBe(422);
    const orphan = menuBody();
    orphan.products[0]!.categoryId = 'cat_yok';
    expect(await (await publish(orphan)).json()).toMatchObject({ code: 'INVALID_MENU', field: 'products[0].categoryId' });
    expect((await publish({ ...menuBody(), tenantId: B.tenantId })).status).toBe(422);
    expect((await publish({ ...menuBody(), schema: 'kasam360.qrmenu.v2' })).status).toBe(422);
  });

  it('paketinde feat_qr_menu yoksa yayınlama ve görsel yükleme 403, hak doğrulanamıyorsa 503 verir', async () => {
    featureKeys = ['feat_kds'];
    const denied = await publish(menuBody());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'FEATURE_NOT_ENTITLED' });
    expect((await upload(webp(100, 100))).status).toBe(403);
    expect(await db.business.collection('qr_menu_publication').countDocuments({})).toBe(0);
    featureKeys = ['feat_qr_menu'];
    clock += 61_000;
    labsDown = true;
    clock += 61_000;
    expect((await publish(menuBody())).status).toBe(503);
  });

  it('durum ucu adresi ve yayın sürümünü verir, slug değiştirmez', async () => {
    await publish(menuBody());
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    const status = await app.request(`/api/desktop/tenants/${A.tenantId}/menu/status`, { headers: desktopHeaders(keyA, DEVICE_A) });
    expect(await status.json()).toMatchObject({ tenantId: A.tenantId, slug: 'kafe-a', enabled: true, entitled: true, version: 1 });
    const write = await app.request(`/api/desktop/tenants/${A.tenantId}/menu/slug`, { method: 'PUT', headers: desktopHeaders(keyA, DEVICE_A), body: '{}' });
    expect(write.status).toBe(404);
  });
});

describe('QR menü işletme adı', () => {
  it('yayındaki businessName öncelikli, yoksa tenant adı public yanıttaki name olur', async () => {
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    await publish(menuBody());
    expect(await (await app.request('/public/menu/kafe-a')).json()).toMatchObject({ name: A.businessName });
    expect(await (await publish(menuBody({ businessName: ' Kafe Güzel ' }))).json()).toMatchObject({ version: 2, changed: true });
    expect(await (await app.request('/public/menu/kafe-a')).json()).toMatchObject({ name: 'Kafe Güzel' });
    expect((await publish(menuBody({ businessName: '' }))).status).toBe(422);
  });
});

describe('QR menü görselleri', () => {
  it('WebP kabul eder, içerik-adresli ve idempotenttir', async () => {
    const bytes = webp(800, 600);
    const first = await upload(bytes);
    expect(first.status).toBe(201);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(await first.json()).toMatchObject({ key: sha256, size: bytes.length, width: 800, height: 600 });
    expect((await upload(bytes)).status).toBe(200);
    expect(await db.business.collection('qr_menu_image').countDocuments({ tenant_id: A.tenantId })).toBe(1);
  });

  it('tür, boyut ve ölçü ihlallerini reddeder', async () => {
    expect((await upload(webp(100, 100), keyA, DEVICE_A, A.tenantId, 'image/png')).status).toBe(415);
    // Başlık webp diyor, baytlar PNG: sihirli bayt denetimi başlığa güvenmez.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    expect((await upload(png)).status).toBe(415);
    expect((await upload(webp(1601, 100))).status).toBe(422);
    expect((await upload(webp(100, 1601))).status).toBe(422);
    const trailing = Buffer.concat([webp(100, 100), Buffer.from('ek')]);
    expect((await upload(trailing)).status).toBe(422);
    expect((await upload(new Uint8Array(0))).status).toBe(422);
    expect((await upload(webp(100, 100, 1_572_864))).status).toBe(413);
    expect(await db.business.collection('qr_menu_image').countDocuments({})).toBe(0);
  });

  it('görsel işletmeye bağlıdır: başka işletmenin görseli menüye konamaz', async () => {
    const bytes = webp(300, 300);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect((await upload(bytes)).status).toBe(201);
    const withImage = menuBody();
    withImage.products[0]!.imageKey = sha256;
    expect((await publish(withImage, keyB, DEVICE_B, B.tenantId)).status).toBe(422);
    expect(await (await publish(withImage, keyB, DEVICE_B, B.tenantId)).json()).toMatchObject({ code: 'UNKNOWN_IMAGE' });
    expect((await publish(withImage)).status).toBe(200);
  });
});

describe('Public QR menü', () => {
  it('slug yok, kapalı veya menü yayınlanmamışsa 404 verir', async () => {
    expect((await app.request('/public/menu/kafe-a')).status).toBe(404);
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    expect((await app.request('/public/menu/kafe-a')).status).toBe(404);
    await publish(menuBody());
    expect((await app.request('/public/menu/kafe-a')).status).toBe(200);
    await assign(A.tenantId, { slug: 'kafe-a', enabled: false });
    expect((await app.request('/public/menu/kafe-a')).status).toBe(404);
    expect((await app.request('/public/menu/..%2Fx')).status).toBe(404);
  });

  it('yalnız yayınlanmış ve etkin ürünleri, gizli alan olmadan, önbellek başlıklarıyla verir', async () => {
    await publish(menuBody());
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    const response = await app.request('/public/menu/kafe-a');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=60');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json() as { categories: { id: string; products: { id: string; priceCents: number; inStock: boolean }[] }[] };
    expect(body).toMatchObject({ schema: 'kasam360.qrmenu.v1', slug: 'kafe-a', version: 1, currency: 'TRY' });
    expect(body.categories.map((category) => category.id)).toEqual(['cat_a', 'cat_b']);
    expect(body.categories[1]!.products).toEqual([expect.objectContaining({ id: 'prd_2', priceCents: 21050, inStock: false, image: null })]);
    const text = JSON.stringify(body);
    for (const secret of [A.tenantId, DEVICE_A, 'prd_gizli', 'tenant', 'active', 'device']) expect(text).not.toContain(secret);
    const etag = response.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"sha256-/);
    expect((await app.request('/public/menu/kafe-a', { headers: { 'if-none-match': etag } })).status).toBe(304);
  });

  it('hak yoksa 404 verir; Labs ulaşılamazsa önbelleksiz kapalı, yakın olumlu sonuç varken açık kalır', async () => {
    await publish(menuBody());
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    expect((await app.request('/public/menu/kafe-a')).status).toBe(200);
    featureKeys = ['feat_kds'];
    clock += 61_000;
    expect((await app.request('/public/menu/kafe-a')).status).toBe(404);
    featureKeys = ['feat_qr_menu'];
    clock += 61_000;
    expect((await app.request('/public/menu/kafe-a')).status).toBe(200);
    // Labs kesilir: son olumlu sonuç 10 dakikadan yeniyse açık, eskiyse kapalı.
    labsDown = true;
    clock += 120_000;
    expect((await app.request('/public/menu/kafe-a')).status).toBe(200);
    clock += 11 * 60_000;
    expect((await app.request('/public/menu/kafe-a')).status).toBe(404);
  });

  it('görseli uzun ve değişmez önbellekle yalnız yayınlanmış menüdeyse verir', async () => {
    const bytes = webp(640, 480);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await upload(bytes);
    await assign(A.tenantId, { slug: 'kafe-a', enabled: true });
    const withImage = menuBody();
    withImage.products[0]!.imageKey = sha256;
    // Yüklendi ama henüz menüde kullanılmıyor.
    await publish(menuBody());
    expect((await app.request(`/public/menu/kafe-a/images/${sha256}.webp`)).status).toBe(404);
    await publish(withImage);
    const image = await app.request(`/public/menu/kafe-a/images/${sha256}.webp`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(image.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(await image.arrayBuffer()).equals(bytes)).toBe(true);
    const menu = await (await app.request('/public/menu/kafe-a')).json() as { categories: { products: { image: string | null }[] }[] };
    expect(menu.categories[0]!.products[0]!.image).toBe(`/public/menu/kafe-a/images/${sha256}.webp`);
    // Başka işletmenin slug'ı altında bu görsel çözülmez.
    await publish(menuBody(), keyB, DEVICE_B, B.tenantId);
    await assign(B.tenantId, { slug: 'kafe-b', enabled: true });
    expect((await app.request(`/public/menu/kafe-b/images/${sha256}.webp`)).status).toBe(404);
    featureKeys = [];
    clock += 61_000;
    expect((await app.request(`/public/menu/kafe-a/images/${sha256}.webp`)).status).toBe(404);
  });
});

describe('Labs slug ataması', () => {
  it('sırsız isteği reddeder; sır yoksa uç hiç bağlanmaz', async () => {
    expect((await assign(A.tenantId, { slug: 'kafe-a', enabled: true }, 'x'.repeat(40))).status).toBe(401);
    const bare = new Hono();
    mountQrMenu(bare, { business: db.business, businessClient: db.businessClient, account: db.account, keys: mongoLicenseKeys(db.account), devices: mongoDeviceLicenses(db.account), entitlement: labsQrMenuEntitlement() });
    const response = await bare.request(`/internal/labs/qr-menu/${A.tenantId}/slug`, { method: 'PUT', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('biçim ve rezerve adları, bilinmeyen işletmeyi reddeder', async () => {
    for (const slug of ['Kafe', 'a', 'ab', '-kafe', 'kafe-', 'kafe--x', 'kafe_x', 'çay', 'x'.repeat(41), 'xn-kafe']) {
      expect(await (await assign(A.tenantId, { slug, enabled: true })).json(), slug).toMatchObject({ code: 'INVALID_SLUG' });
    }
    for (const slug of ['www', 'api', 'admin', 'menu', 'labs']) {
      const response = await assign(A.tenantId, { slug, enabled: true });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'SLUG_RESERVED' });
    }
    expect((await assign('tnt_01arz3ndektsv4rrffq69g5faz', { slug: 'kafe-z', enabled: true })).status).toBe(404);
    expect((await assign(A.tenantId, { slug: 'kafe-a' })).status).toBe(422);
    expect(await db.business.collection('qr_menu_slug').countDocuments({})).toBe(0);
    expect(checkSlug('kafe-1')).toBe('ok');
  });

  it('çakışmayı 409 ile reddeder, değişiklik eski adı serbest bırakır, tekrar idempotenttir', async () => {
    expect((await assign(A.tenantId, { slug: 'kafe-a', enabled: true })).status).toBe(200);
    expect((await assign(A.tenantId, { slug: 'kafe-a', enabled: true })).status).toBe(200);
    const taken = await assign(B.tenantId, { slug: 'kafe-a', enabled: true });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect((await assign(A.tenantId, { slug: 'kafe-yeni', enabled: true })).status).toBe(200);
    expect((await assign(B.tenantId, { slug: 'kafe-a', enabled: true })).status).toBe(200);
    expect(await db.business.collection('qr_menu_slug').countDocuments({})).toBe(2);
    // Eşzamanlı aynı adres istekleri: tekil dizin tek kazananı bırakır.
    const raced = await Promise.all([assign(A.tenantId, { slug: 'yaris-adi', enabled: true }), assign(B.tenantId, { slug: 'yaris-adi', enabled: true })]);
    expect(raced.map((response) => response.status).sort()).toEqual([200, 409]);
  });
});
