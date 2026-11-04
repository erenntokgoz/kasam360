import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mountCustomerProvisioning } from './customerProvisioning.js';
import { createApp } from './app.js';
import { createAuth } from './lib/auth.js';
import type { Mail } from './lib/mail.js';
import { ulid } from './lib/prefixedId.js';
import { validateProfile } from './lib/profile.js';

const SITE = 'http://localhost:3000';
const DESKTOP = 'http://tauri.localhost';
const LINK = '11111111-2222-3333-4444-555555555555';
const SECRET = 'test-secret-test-secret-test-secret';
const PORT = 54329;
// Yalnız kendi alt klasörünü siler: geliştirme veritabanı .test-db/dev altındadır.
const dataDir = join(process.cwd(), '.test-db', 'unit');

const database = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'test',
  password: 'test',
  port: PORT,
  persistent: false,
  // Windows'un yerel dil adı ASCII dışı karakter taşıyınca veritabanı kurulumu reddediliyor.
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  onLog: () => {},
  onError: () => {},
});
let pool: Pool;
let app: ReturnType<typeof createApp>;
const mails: Mail[] = [];

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
  await database.initialise();
  await database.start();
  await database.createDatabase('kasam360');
  pool = new Pool({ connectionString: `postgres://test:test@localhost:${PORT}/kasam360` });
  const auth = createAuth({
    pool,
    secret: SECRET,
    siteUrl: SITE,
    allowedOrigins: [SITE, DESKTOP],
    google: { clientId: 'test-id', clientSecret: 'test-secret' },
    sendMail: async (mail) => {
      mails.push(mail);
    },
  });
  await (await getMigrations(auth.options)).runMigrations();
  app = createApp(auth, [SITE, DESKTOP], SITE);
  mountCustomerProvisioning(app, pool, SECRET);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await database.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  mails.length = 0;
  await pool.query('TRUNCATE "user", "session", "account", "verification" CASCADE');
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

describe('kayıt', () => {
  it('hesabı önekli kimlik, Argon2id şifre ve onay anıyla yazar, doğrulama maili atar', async () => {
    expect((await post('/sign-up/email', valid)).status).toBe(200);
    const { rows } = await pool.query(
      'SELECT u.id, u."emailVerified", u."businessName", u."consentAt", a.password FROM "user" u JOIN account a ON a."userId" = u.id',
    );
    expect(rows[0].id).toMatch(/^usr_/);
    expect(rows[0].emailVerified).toBe(false);
    expect(rows[0].businessName).toBe('Liman Lokantası');
    expect(rows[0].consentAt).toBeInstanceOf(Date);
    expect(rows[0].password).toMatch(/^\$argon2id\$/);
    expect(mails.map((mail) => mail.to)).toEqual([valid.email]);
  });

  it('onaysız ve hatalı formu alan hatalarıyla reddeder', async () => {
    const response = await post('/sign-up/email', { ...valid, consent: false, name: 'x' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: { name: expect.any(String), consent: expect.any(String) } });
    expect((await pool.query('SELECT 1 FROM "user"')).rowCount).toBe(0);
  });

  it('izinsiz kaynağı reddeder', async () => {
    expect((await post('/sign-up/email', valid, { origin: 'https://baska.example' })).status).toBe(403);
    expect((await post('/sign-up/email', valid, { origin: '' })).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM "user"')).rowCount).toBe(0);
  });

  it('kayıtlı e-postayı belli etmez ve ikinci hesap açmaz', async () => {
    await post('/sign-up/email', valid);
    expect((await post('/sign-up/email', { ...valid, password: 'baska-sifre-2' })).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM "user"')).rowCount).toBe(1);
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
    expect((await app.request(`/api/desktop-link/${LINK}/finish`, { headers: { cookie } })).status).toBe(200);
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
    expect((await pool.query('SELECT 1 FROM "user"')).rowCount).toBe(1);
    expect((await post('/delete-user', { password: valid.password }, { cookie })).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM "user"')).rowCount).toBe(0);
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
  const user = (await pool.query('SELECT "emailVerified","consentAt" FROM "user" WHERE email=$1', [fields.email])).rows[0];
  expect(user).toEqual({ emailVerified: false, consentAt: null });
  expect((await post('/sign-in/email', { email: fields.email, password: fields.password })).status).toBe(403);
  await app.request(linkIn(mails.at(-1)));
  const session = await post('/sign-in/email', { email: fields.email, password: fields.password });
  expect(session.status).toBe(200);
  expect(cookies(session)).not.toBe('');
});
