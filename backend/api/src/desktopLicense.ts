import { createHash, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Pool } from 'pg';
import type { Auth } from './lib/auth.js';
import { issueLicense, readDevice, type LicenseSubject } from './license.js';
import type { SupportConfig } from './support.js';

// Masaüstü web oturumu tutmaz: personel kasada çalışırken site çerezi yoktur. Sahip hesabıyla
// bir kez bağlanan cihaz uzun ömürlü bir lisans anahtarı alır ve yalnız lisans yenilemek için
// kullanır. Anahtar sunucuda özet olarak durur; çalınırsa hesap silinince veya iptalle düşer.
const KEY = /^lk_[A-Za-z0-9_-]{43}$/;

export const LICENSE_KEY_TABLE = `CREATE TABLE IF NOT EXISTS desktop_license_key (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "keyHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastUsedAt" TIMESTAMPTZ
)`;

export interface KeyOwner extends LicenseSubject {
  emailVerified: boolean;
}

export interface LicenseKeys {
  create(userId: string): Promise<string>;
  find(key: string): Promise<KeyOwner | null>;
}

const digest = (key: string) => createHash('sha256').update(key).digest('hex');

export function pgLicenseKeys(pool: Pool): LicenseKeys {
  return {
    async create(userId) {
      const key = `lk_${randomBytes(32).toString('base64url')}`;
      await pool.query(
        'INSERT INTO desktop_license_key (id,"userId","keyHash") VALUES ($1,$2,$3)',
        [`lky_${randomBytes(16).toString('hex')}`, userId, digest(key)],
      );
      return key;
    },
    async find(key) {
      if (!KEY.test(key)) return null;
      const { rows } = await pool.query<KeyOwner>(
        `UPDATE desktop_license_key k SET "lastUsedAt"=now() FROM "user" u
         WHERE k."keyHash"=$1 AND u.id=k."userId"
         RETURNING u.id,u.email,u."emailVerified"`,
        [digest(key)],
      );
      return rows[0] ?? null;
    },
  };
}

const MESSAGES: Record<string, string> = {
  EMAIL_NOT_VERIFIED: 'Önce e-postanızı doğrulayın.',
  INVALID_EMAIL_OR_PASSWORD: 'E-posta veya şifre hatalı.',
};

export function mountDesktopLicense(
  app: Hono,
  auth: Auth,
  keys: LicenseKeys,
  siteUrl: string,
  labs?: SupportConfig,
  signing?: KeyObject,
) {
  app.use('/api/desktop/license-key', bodyLimit({ maxSize: 4096 }));

  // Şifre hesap kütüphanesinin kendi giriş yolundan doğrulanır: deneme sınırı ve e-posta
  // doğrulaması aynen uygulanır. Açılan geçici web oturumu hemen kapatılır.
  app.post('/api/desktop/license-key', async (context) => {
    context.header('Cache-Control', 'no-store');
    const data: unknown = await context.req.json().catch(() => null);
    if (!data || typeof data !== 'object' || !('email' in data) || typeof data.email !== 'string' ||
        !('password' in data) || typeof data.password !== 'string' ||
        data.email.length > 254 || data.password.length > 128) {
      return context.json({ message: 'E-posta ve şifre gerekli.' }, 422);
    }
    const headers = new Headers({ 'content-type': 'application/json', origin: siteUrl });
    const forwarded = context.req.header('x-forwarded-for');
    if (forwarded) headers.set('x-forwarded-for', forwarded);
    const signedIn = await auth.handler(new Request(`${siteUrl}/api/auth/sign-in/email`, {
      method: 'POST', headers, body: JSON.stringify({ email: data.email, password: data.password }),
    }));
    const reply = await signedIn.json().catch(() => null) as { user?: { id?: string }; code?: string } | null;
    const cookie = signedIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    if (cookie) await auth.api.signOut({ headers: new Headers({ cookie }) }).catch(() => undefined);
    if (signedIn.status === 429) return context.json({ message: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.' }, 429);
    if (!signedIn.ok || !reply?.user?.id) {
      const message = MESSAGES[reply?.code ?? ''] ?? 'E-posta veya şifre hatalı.';
      return context.json({ message }, signedIn.status === 403 ? 403 : 401);
    }
    return context.json({ key: await keys.create(reply.user.id) }, 201);
  });

  app.get('/api/desktop/license', async (context) => {
    context.header('Cache-Control', 'no-store');
    const bearer = /^Bearer (\S+)$/.exec(context.req.header('authorization') ?? '')?.[1] ?? '';
    const owner = await keys.find(bearer);
    if (!owner) return context.json({ message: 'Lisans anahtarı geçersiz. Cihazı yeniden bağlayın.' }, 401);
    if (!owner.emailVerified) return context.json({ message: 'Önce e-postanızı doğrulayın.' }, 403);
    const reply = await issueLicense(labs, signing, owner, readDevice((name) => context.req.header(name)));
    return context.json(reply.body, reply.status);
  });
}
