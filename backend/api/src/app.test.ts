import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mongoLicenseKeys, mountDesktopLicense } from './desktopLicense.js';
import { signingKey } from './license.js';
import { mountCustomerProvisioning } from './customerProvisioning.js';
import { createApp } from './app.js';
import { createAuth } from './lib/auth.js';
import type { Mail } from './lib/mail.js';
import { ulid } from './lib/prefixedId.js';
import { validateProfile } from './lib/profile.js';
import { startTestDatabases, type TestDatabases } from './testDb.js';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceFixtures.js';

const SITE = 'http://localhost:3000';
const DESKTOP = 'http://tauri.localhost';
const LINK = '11111111-2222-3333-4444-555555555555';
const SECRET = 'test-secret-test-secret-test-secret';
let db: TestDatabases;
let app: ReturnType<typeof createApp>;
let authInstance: ReturnType<typeof createAuth>;
const mails: Mail[] = [];
const userCount = () => db.account.collection('user').countDocuments();

const valid = { name: 'Ayşe Yılmaz', businessName: 'Liman Lokantası', email: 'ayse@example.com', password: 'guclu-sifre-1', consent: true };

// Her istek ayrı adresten gelir; sınır sayacı yalnız kendi testinde devreye girer.
let requestCount = 0;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  requestCount += 1;
  return app.request(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'x-forwarded-for': `10.0.${requestCount >> 8}.${requestCount & 255}`, ...headers },
    body: JSON.stringify(body),
  });
}

const codeIn = (mail: Mail | undefined) => /\b\d{6}\b/.exec(mail?.text ?? '')?.[0] ?? '';

function linkIn(mail: Mail | undefined) {
  const url = /http\S+/.exec(mail?.text ?? '')?.[0];
  if (!url) throw new Error('bağlantı yok');
  return url.replace(SITE, '');
}

const cookies = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');

const getSession = async (cookie: string) => (await app.request('/api/auth/get-session', { headers: { cookie } })).json();

async function registerAndVerify() {
  await post('/sign-up/email', { ...valid, callbackURL: '/hesabim' });
  return app.request(linkIn(mails.at(-1)));
}

beforeAll(async () => {
  db = await startTestDatabases();
  const auth = createAuth({
    databases: db,
    secret: SECRET,
    siteUrl: SITE,
    allowedOrigins: [SITE, DESKTOP],
    google: { clientId: 'test-id', clientSecret: 'test-secret' },
    sendMail: async (mail) => {
      mails.push(mail);
    },
  });
  authInstance = auth;
  const keys = mongoLicenseKeys(db.account);
  app = createApp(auth, [SITE, DESKTOP], SITE, undefined, keys, db, {
    labsOrigin: 'https://labs.example.test', labsToken: 'labs_server_only',
    fetcher: (input, init) => globalThis.fetch(input, init),
  });
  mountCustomerProvisioning(app, db, SECRET);
  const { privateKey } = generateKeyPairSync('ed25519');
  mountDesktopLicense(app, auth, keys, SITE, { origin: 'http://127.0.0.1:3600', token: 'labs' },
    signingKey(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')));
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  mails.length = 0;
  await db.reset();
});

describe('yardımcılar', () => {
  it('ulid sıralı ve 26 karakterdir', () => {
    expect(ulid(1000)).toHaveLength(26);
    expect(ulid(1000).slice(0, 10) < ulid(2000).slice(0, 10)).toBe(true);
  });

  it('metin onayını gerçek onay saymaz, satır sonunu reddeder', () => {
    expect(validateProfile({ ...valid, consent: 'true' }, true).consent).toBeDefined();
    expect(validateProfile({ ...valid, businessName: 'Kafe\nBcc: x' }, true).businessName).toBeDefined();
    expect(validateProfile(valid, true)).toEqual({});
  });
});

describe('işletme üyeliği C02', () => {
  it('işletmeyi OWNER üyeliğiyle bir kez oluşturur ve başka tenant okumasını gizler', async () => {
    const verified = await registerAndVerify();
    const cookie = cookies(verified);
    expect(cookie).not.toBe('');
    const headers = { cookie, 'content-type': 'application/json', origin: SITE, 'idempotency-key': '123e4567-e89b-42d3-a456-426614174000' };
    const body = { businessName: 'TEST_A Kafe', country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul' };
    const first = await app.request('/v1/tenants', { method: 'POST', headers, body: JSON.stringify(body) });
    expect(first.status).toBe(201);
    const firstReply = await first.json() as { tenant: { tenantId: string }; membership: { role: string; tenantId: string } };
    expect(firstReply.membership.role).toBe('OWNER');
    expect(firstReply.tenant.tenantId).toMatch(/^tnt_[0-7][0-9A-HJKMNP-TV-Z]{25}$/i);
    expect(firstReply.membership.tenantId).toBe(firstReply.tenant.tenantId);
    const replay = await app.request('/v1/tenants', { method: 'POST', headers, body: JSON.stringify(body) });
    expect(replay.status).toBe(200);
    const replayReply = await replay.json() as { tenant: { tenantId: string } };
    expect(replayReply.tenant.tenantId).toBe(firstReply.tenant.tenantId);
    expect(await db.account.collection('tenant').countDocuments({})).toBe(1);
    const other = await app.request('/v1/tenants/tnt_01arz3ndektsv4rrffq69g5faw', { headers: { cookie } });
    expect(other.status).toBe(404);
  });

  it('bağlanmamış yeni işletmenin hakkını okurken önce Labs bağını kurar', async () => {
    const linked = new Set<string>();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const tenantId = decodeURIComponent(url.split('/').at(-2) ?? '');
      if (url.endsWith('/bagla') && init?.method === 'PUT') { linked.add(tenantId); return Response.json({ tenantId, linked: true }); }
      if (url.endsWith('/hak')) {
        if (!linked.has(tenantId)) return new Response(null, { status: 404 });
        return Response.json({ tenantId, productId: ACCEPTANCE_CONTRACT_IDS.TEST_A.productId, status: 'inactive', source: 'none', packageId: null,
          packageVersion: null, featureKeys: [], deviceLimit: 0, validFrom: null, validUntil: null, revision: 0 });
      }
      return new Response(null, { status: 404 });
    }));
    const cookie = cookies(await registerAndVerify());
    const created = await app.request('/v1/tenants', {
      method: 'POST', headers: { cookie, origin: SITE, 'content-type': 'application/json', 'idempotency-key': '123e4567-e89b-42d3-a456-426614174009' },
      body: JSON.stringify({ businessName: 'Yeni Kafe', country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul' }),
    });
    const tenantId = (await created.json() as { tenant: { tenantId: string } }).tenant.tenantId;
    const rights = await app.request(`/v1/tenants/${tenantId}/entitlement`, { headers: { cookie } });
    expect(rights.status).toBe(200);
    expect(await rights.json()).toMatchObject({ tenantId, status: 'inactive' });
    expect(linked.has(tenantId)).toBe(true);
  });

  it('entitlement proxy tenant OWNER ile sınırlar ve checkout niyetini seçili fiyata bağlar', async () => {
    const testA = ACCEPTANCE_CONTRACT_IDS.TEST_A;
    const testB = ACCEPTANCE_CONTRACT_IDS.TEST_B;
    const entitlementA = {
      tenantId: testA.tenantId, productId: testA.productId, status: 'active', source: 'manual',
      packageId: testA.packageId, packageVersion: 1, featureKeys: ['feat_kds'], deviceLimit: 2,
      validFrom: '2026-11-06T10:00:00Z', validUntil: '2026-12-06T10:00:00Z', revision: 1793968800000,
    };
    const entitlementB = { ...entitlementA, tenantId: testB.tenantId, productId: testB.productId, source: 'subscription' };
    const labsCalls: { url: string; method: string; body: string }[] = [];
    const linkedTenantIds: string[] = [];
    const labsFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      labsCalls.push({ url, method, body });
      if (url.endsWith('/bagla') && method === 'PUT') {
        const tenantId = decodeURIComponent(url.split('/').at(-2) ?? '');
        linkedTenantIds.push(tenantId);
        return Response.json({ tenantId, linked: true });
      }
      if (url.endsWith('/hak')) {
        const requestedTenant = decodeURIComponent(url.split('/').at(-2) ?? '');
        const isA = requestedTenant === linkedTenantIds[0];
        return Response.json({ ...(isA ? entitlementA : entitlementB), tenantId: requestedTenant });
      }
      if (url.endsWith('/checkout-intents')) {
        const checkoutRequest = JSON.parse(body) as { tenantId: string; priceId: string };
        return Response.json({ checkoutIntentId: testA.checkoutId, tenantId: checkoutRequest.tenantId, productId: testA.productId, packageId: testA.packageId, packageVersion: 1, priceId: checkoutRequest.priceId, status: 'awaiting_provider' });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', labsFetch);

    const ownerAResponse = await registerAndVerify();
    const ownerACookie = cookies(ownerAResponse);
    const createTenant = async (cookie: string, businessName: string, idempotencyKey: string) => app.request('/v1/tenants', {
      method: 'POST', headers: { cookie, origin: SITE, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ businessName, country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul' }),
    });
    const ownerATenantResponse = await createTenant(ownerACookie, 'TEST_A', '123e4567-e89b-42d3-a456-426614174001');
    const ownerATenant = (await ownerATenantResponse.json() as { tenant: { tenantId: string } }).tenant.tenantId;
    const linkedA = await app.request(`/v1/tenants/${ownerATenant}/commercial-link`, { method: 'PUT', headers: { cookie: ownerACookie } });
    expect(linkedA.status).toBe(200);

    const requestsBeforeForbidden = labsCalls.length;
    const ownerBSignUp = await post('/sign-up/email', { ...valid, email: 'owner.b@kasam360.invalid', name: 'TEST_B Sahibi' });
    expect(ownerBSignUp.status).toBe(200);
    const ownerBVerified = await app.request(linkIn(mails.at(-1)));
    const ownerBCookie = cookies(ownerBVerified);
    const foreignRead = await app.request(`/v1/tenants/${ownerATenant}/entitlement`, { headers: { cookie: ownerBCookie } });
    expect(foreignRead.status).toBe(404);
    expect(labsCalls).toHaveLength(requestsBeforeForbidden);

    const ownerBTenantResponse = await createTenant(ownerBCookie, 'TEST_B', '123e4567-e89b-42d3-a456-426614174002');
    const ownerBTenant = (await ownerBTenantResponse.json() as { tenant: { tenantId: string } }).tenant.tenantId;
    expect((await app.request(`/v1/tenants/${ownerBTenant}/commercial-link`, { method: 'PUT', headers: { cookie: ownerBCookie } })).status).toBe(200);
    const rightsA = await app.request(`/v1/tenants/${ownerATenant}/entitlement`, { headers: { cookie: ownerACookie } });
    const rightsB = await app.request(`/v1/tenants/${ownerBTenant}/entitlement`, { headers: { cookie: ownerBCookie } });
    expect(await rightsA.json()).toEqual({ ...entitlementA, tenantId: ownerATenant });
    expect(await rightsB.json()).toEqual({ ...entitlementB, tenantId: ownerBTenant });

    const idempotencyKey = '123e4567-e89b-42d3-a456-426614174003';
    const checkout = () => app.request(`/v1/tenants/${ownerATenant}/checkout-intents`, {
      method: 'POST', headers: { cookie: ownerACookie, origin: SITE, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ priceId: testA.priceId }),
    });
    const firstIntent = await checkout();
    const repeatedIntent = await checkout();
    expect(firstIntent.status).toBe(201);
    const firstIntentBody = await firstIntent.json();
    const repeatedIntentBody = await repeatedIntent.json();
    expect(firstIntentBody).toEqual(repeatedIntentBody);
    const checkoutCall = labsCalls.find((call) => call.url.endsWith('/checkout-intents'));
    expect(JSON.parse(checkoutCall?.body ?? '{}')).toMatchObject({ tenantId: ownerATenant, priceId: testA.priceId, idempotencyKey });
    expect((repeatedIntentBody as { status: string }).status).toBe('awaiting_provider');
  });
});

describe('kayıt', () => {
  it('hesabı önekli kimlik, Argon2id şifre ve onay anıyla yazar, doğrulama maili atar', async () => {
    expect((await post('/sign-up/email', valid)).status).toBe(200);
    const user = await db.account.collection<{ _id: string; emailVerified?: boolean; businessName?: string; consentAt?: Date }>('user').findOne({});
    const credential = await db.account.collection('account').findOne({ userId: user?._id });
    expect(user?._id).toMatch(/^usr_/);
    expect(user?.emailVerified).toBe(false);
    expect(user?.businessName).toBe('Liman Lokantası');
    expect(user?.consentAt).toBeInstanceOf(Date);
    expect(credential?.password).toMatch(/^\$argon2id\$/);
    expect(mails.map((mail) => mail.to)).toEqual([valid.email]);
  });

  it('onaysız ve hatalı formu alan hatalarıyla reddeder', async () => {
    const response = await post('/sign-up/email', { ...valid, consent: false, name: 'x' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: { name: expect.any(String), consent: expect.any(String) } });
    expect(await userCount()).toBe(0);
  });

  it('izinsiz kaynağı reddeder', async () => {
    expect((await post('/sign-up/email', valid, { origin: 'https://baska.example' })).status).toBe(403);
    expect((await post('/sign-up/email', valid, { origin: '' })).status).toBe(403);
    expect(await userCount()).toBe(0);
  });

  it('kayıtlı e-postayı belli etmez ve ikinci hesap açmaz', async () => {
    await post('/sign-up/email', valid);
    expect((await post('/sign-up/email', { ...valid, password: 'baska-sifre-2' })).status).toBe(200);
    expect(await userCount()).toBe(1);
  });
});

describe('giriş', () => {
  it('doğrulanmamış hesabı içeri almaz', async () => {
    await post('/sign-up/email', valid);
    const response = await post('/sign-in/email', { email: valid.email, password: valid.password });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('doğrulama sonrası oturum açar, profil günceller ve çıkış yapar', async () => {
    const verified = await registerAndVerify();
    expect(verified.headers.get('location')).toContain('/hesabim');
    const login = await post('/sign-in/email', { email: valid.email, password: valid.password });
    expect(login.status).toBe(200);
    const cookie = cookies(login);

    expect((await post('/update-user', { phone: '0532 000 00 00' }, { cookie })).status).toBe(200);
    expect((await post('/update-user', { phone: 'abc' }, { cookie })).status).toBe(422);
    expect(await getSession(cookie)).toMatchObject({ user: { phone: '0532 000 00 00', businessName: 'Liman Lokantası' } });

    await post('/sign-out', {}, { cookie });
    expect(await getSession(cookie)).toBeNull();
  });

  it('yanlış şifreyi reddeder ve sınırı aşan istemciyi durdurur', async () => {
    await registerAndVerify();
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    const wrong = { email: valid.email, password: 'yanlis-sifre' };
    expect((await post('/sign-in/email', wrong, ip)).status).toBe(401);
    for (let attempt = 0; attempt < 9; attempt += 1) await post('/sign-in/email', wrong, ip);
    expect((await post('/sign-in/email', { email: valid.email, password: valid.password }, ip)).status).toBe(429);
  });
});

describe('masaüstü ve hesap silme', () => {
  it('izinli kaynağa izin verir, başkasına vermez', async () => {
    const preflight = (origin: string) =>
      app.request('/api/auth/sign-in/email', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
    expect((await preflight(SITE)).headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await preflight('https://baska.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('Google adresini hesap seçimiyle açar, durum çerezini tarayıcıya bırakır', async () => {
    const response = await app.request(`/api/desktop-link/${LINK}/google`);
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location') ?? '');
    expect(target.host).toBe('accounts.google.com');
    expect(target.searchParams.get('prompt')).toBe('select_account');
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('oturumlu bitişte hesap bilgisi bir kez masaüstüne geçer', async () => {
    expect((await app.request(`/api/desktop-link/${LINK}/finish`)).status).toBe(400);
    expect((await app.request(`/api/desktop-link/${LINK}`)).status).toBe(204);

    await registerAndVerify();
    const cookie = cookies(await post('/sign-in/email', { email: valid.email, password: valid.password }));
    // Uygulamanın başlatmadığı kod oturumlu olsa da tamamlanamaz.
    expect((await app.request(`/api/desktop-link/${LINK}/finish`, { headers: { cookie } })).status).toBe(400);
    await app.request(`/api/desktop-link/${LINK}/google`);
    const done = await app.request(`/api/desktop-link/${LINK}/finish`, { headers: { cookie } });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('kasam360://google-done');
    // Aynı kodla ikinci bitiş reddedilir.
    expect((await app.request(`/api/desktop-link/${LINK}/finish`, { headers: { cookie } })).status).toBe(400);
    expect(await (await app.request(`/api/desktop-link/${LINK}`)).json()).toMatchObject({ email: valid.email, businessName: valid.businessName });
    expect((await app.request(`/api/desktop-link/${LINK}`)).status).toBe(204);
  });

  it('uygulamadan kayıtta bağlantı maili atmaz, kodla doğrular', async () => {
    const desktop = { origin: DESKTOP };
    expect((await post('/sign-up/email', valid, desktop)).status).toBe(200);
    expect(mails).toHaveLength(0);
    expect((await post('/email-otp/send-verification-otp', { email: valid.email, type: 'email-verification' }, desktop)).status).toBe(200);
    expect(mails).toHaveLength(1);
    expect((await post('/email-otp/verify-email', { email: valid.email, otp: '000000' }, desktop)).status).toBe(400);
    expect((await post('/email-otp/verify-email', { email: valid.email, otp: codeIn(mails[0]) }, desktop)).status).toBe(200);
    expect((await post('/sign-in/email', { email: valid.email, password: valid.password }, desktop)).status).toBe(200);
  });

  it('uygulamadan kodla şifre yeniler, kayıtsız e-postayı belli etmez', async () => {
    await registerAndVerify();
    mails.length = 0;
    const desktop = { origin: DESKTOP };
    expect((await post('/email-otp/request-password-reset', { email: 'yok@example.com' }, desktop)).status).toBe(200);
    expect(mails).toHaveLength(0);
    expect((await post('/email-otp/request-password-reset', { email: valid.email }, desktop)).status).toBe(200);
    expect((await post('/email-otp/reset-password', { email: valid.email, otp: codeIn(mails[0]), password: 'yeni-guclu-sifre-2' }, desktop)).status).toBe(200);
    expect((await post('/sign-in/email', { email: valid.email, password: 'yeni-guclu-sifre-2' }, desktop)).status).toBe(200);
    expect((await post('/sign-in/email', { email: valid.email, password: valid.password }, desktop)).status).toBe(401);
  });

  it('girişte kurulum formunu dolduracak bilgileri döner', async () => {
    await registerAndVerify();
    const login = await post('/sign-in/email', { email: valid.email, password: valid.password });
    expect(await login.json()).toMatchObject({ user: { name: valid.name, email: valid.email, businessName: valid.businessName } });
  });

  it('şifreyle hesabı siler, yanlış şifreyle silmez', async () => {
    await registerAndVerify();
    const cookie = cookies(await post('/sign-in/email', { email: valid.email, password: valid.password }));
    expect((await post('/delete-user', { password: 'yanlis-sifre' }, { cookie })).status).toBe(400);
    expect(await userCount()).toBe(1);
    expect((await post('/delete-user', { password: valid.password }, { cookie })).status).toBe(200);
    expect(await userCount()).toBe(0);
  });
});

describe('şifre sıfırlama', () => {
  it('kayıtsız e-postayı belli etmez, mail atmaz', async () => {
    expect((await post('/request-password-reset', { email: 'yok@example.com', redirectTo: '/sifre-yenile' })).status).toBe(200);
    expect(mails).toHaveLength(0);
  });

  it('tek kullanımlık bağlantıyla şifreyi değiştirir, eski oturumu kapatır, bilgi maili atar', async () => {
    await registerAndVerify();
    const oldLogin = cookies(await post('/sign-in/email', { email: valid.email, password: valid.password }));
    await post('/request-password-reset', { email: valid.email, redirectTo: '/sifre-yenile' });
    const redirect = await app.request(linkIn(mails.at(-1)));
    const token = new URL(redirect.headers.get('location') ?? '', SITE).searchParams.get('token');
    expect(token).toBeTruthy();

    const newPassword = 'yeni-guclu-sifre-2';
    expect((await post('/reset-password', { newPassword, token })).status).toBe(200);
    expect((await post('/reset-password', { newPassword: 'ucuncu-sifre-3', token })).status).toBe(400);
    expect(mails.at(-1)?.subject).toContain('değişti');
    expect((await post('/sign-in/email', { email: valid.email, password: valid.password })).status).toBe(401);
    expect((await post('/sign-in/email', { email: valid.email, password: newPassword })).status).toBe(200);
    expect(await getSession(oldLogin)).toBeNull();
  });
});

it('creates a usable customer credential without verifying email or overwriting it on retry', async () => {
  const fields = { id: 'cus_01ARZ3NDEKTSV4RRFFQ69G5FAV', email: 'provisioned@example.com', name: 'Örnek Müşteri', password: 'first-password-9' };
  const create = (input = fields, token = SECRET) => app.request('/internal/labs/customers', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  expect((await create(fields, 'invalid')).status).toBe(401);
  expect((await create()).status).toBe(201);
  expect((await create()).status).toBe(200);
  expect((await create({ ...fields, password: 'changed-password-9' })).status).toBe(409);
  expect((await create({ ...fields, id: 'cus_01ARZ3NDEKTSV4RRFFQ69G5FAW' })).status).toBe(409);
  const user = await db.account.collection('user').findOne({ email: fields.email });
  expect({ emailVerified: user?.emailVerified, consentAt: user?.consentAt ?? null }).toEqual({ emailVerified: false, consentAt: null });
  const before = mails.length;
  expect((await post('/sign-in/email', { email: fields.email, password: fields.password })).status).toBe(403);
  // Giriş denemesi kendiliğinden posta atmaz; istemci iki dakikalık sayaçla açıkça ister.
  expect(mails.length).toBe(before);
  expect((await post('/send-verification-email', { email: fields.email })).status).toBe(200);
  await app.request(linkIn(mails.at(-1)));
  const session = await post('/sign-in/email', { email: fields.email, password: fields.password });
  expect(session.status).toBe(200);
  expect(cookies(session)).not.toBe('');
});

it('Google doğrulanmamış hesaba bağlanınca önceden konmuş şifreyi ve oturumları geçersiz kılar', async () => {
  await post('/sign-up/email', { ...valid, callbackURL: '/hesabim' });
  const user = await db.account.collection('user').findOne({ email: valid.email });
  expect(user?.emailVerified).toBe(false);
  const context = await authInstance.$context;
  const userId = String(user?._id);
  const hook = authInstance.options.databaseHooks?.account?.create?.before;
  if (!hook) throw new Error('Google bağlama kancası yok');
  await hook({ id: 'acc_test', providerId: 'google', accountId: 'g-1', userId, createdAt: new Date(), updatedAt: new Date() },
    { context } as Parameters<typeof hook>[1]);
  const accounts = await context.internalAdapter.findAccounts(userId);
  expect(accounts.some((account) => account.providerId === 'credential')).toBe(false);
  expect((await context.internalAdapter.findUserById(userId))?.emailVerified).toBe(true);
  // Ön kayıtta konan şifre artık giriş açmaz.
  expect((await post('/sign-in/email', { email: valid.email, password: valid.password })).status).not.toBe(200);
});

describe('masaüstü lisans anahtarı', () => {
  it('doğru şifreyle anahtar verir, anahtarla cihaz lisansı alır, web oturumu bırakmaz', async () => {
    await registerAndVerify();
    const keyFor = (password: string) => app.request('/api/desktop/license-key', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.1' },
      body: JSON.stringify({ email: valid.email, password }),
    });
    expect((await keyFor('yanlis-sifre-1')).status).toBe(401);
    const sessions = async () => db.account.collection('session').countDocuments();
    const before = await sessions();
    const created = await keyFor(valid.password);
    expect(created.status).toBe(201);
    const { key } = await created.json() as { key: string };
    expect(key).toMatch(/^lk_/);
    // Anahtar almak için açılan geçici oturum kapanır.
    expect(await sessions()).toBe(before);

    const upstream = vi.fn(async () => Response.json({
      valid_until: '2027-01-31', blocked: false, device: 'active',
      package: { name: 'Temel', features: ['feat_kds'], device_limit: 1 },
    }));
    vi.stubGlobal('fetch', upstream);
    try {
      const license = (bearer: string, device = 'dev_0123456789') => app.request('/api/desktop/license', {
        headers: { authorization: `Bearer ${bearer}`, 'x-device-id': device, 'x-device-name': 'Kasa 1' },
      });
      expect((await license('lk_' + 'x'.repeat(43))).status).toBe(401);
      expect((await license(key, 'x')).status).toBe(400);
      const issued = await license(key);
      expect(issued.status).toBe(200);
      const { claims } = await issued.json() as { claims: Record<string, unknown> };
      expect(claims).toMatchObject({ email: valid.email, deviceId: 'dev_0123456789', validUntil: '2027-01-31' });
      const sent = JSON.parse(String((upstream.mock.calls[0] as unknown as [URL, RequestInit])[1].body));
      expect(sent).toMatchObject({ email: valid.email, device: { id: 'dev_0123456789', name: 'Kasa 1' } });
      // Hesap silinince anahtar da düşer.
      await db.account.collection('user').deleteMany({});
      expect((await license(key)).status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
