import { createHash, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from 'mongodb';
import type { Auth } from './lib/auth.js';
import { issueLicense, readDevice, type LicenseSubject } from './license.js';
import type { SupportConfig } from './support.js';
import type { DeviceLicenses } from './sync/deviceLicenses.js';

// Masaüstü web oturumu tutmaz: personel kasada çalışırken site çerezi yoktur. Sahip hesabıyla
// bir kez bağlanan cihaz uzun ömürlü bir lisans anahtarı alır ve yalnız lisans yenilemek için
// kullanır. Anahtar sunucuda özet olarak durur; çalınırsa hesap silinince veya iptalle düşer.
const KEY = /^lk_[A-Za-z0-9_-]{43}$/;

export interface KeyOwner extends LicenseSubject {
  emailVerified: boolean;
}

export interface LicenseKeys {
  create(userId: string): Promise<string>;
  find(key: string): Promise<KeyOwner | null>;
}

const digest = (key: string) => createHash('sha256').update(key).digest('hex');

export function mongoLicenseKeys(db: Db): LicenseKeys {
  const keys = db.collection<{ _id: string; userId: string; keyHash: string; createdAt: Date; lastUsedAt: Date | null }>('desktop_license_key');
  const users = db.collection<{ _id: string; email: string; emailVerified: boolean }>('user');
  return {
    async create(userId) {
      const key = `lk_${randomBytes(32).toString('base64url')}`;
      await keys.insertOne({ _id: `lky_${randomBytes(16).toString('hex')}`, userId, keyHash: digest(key), createdAt: new Date(), lastUsedAt: null });
      return key;
    },
    // Silinmiş hesabın anahtarı geçmez: sahip kaydı yoksa anahtar bulunmamış sayılır.
    async find(key) {
      if (!KEY.test(key)) return null;
      const stored = await keys.findOneAndUpdate({ keyHash: digest(key) }, { $set: { lastUsedAt: new Date() } });
      if (!stored) return null;
      const user = await users.findOne({ _id: stored.userId }, { projection: { email: 1, emailVerified: 1 } });
      return user ? { id: user._id, email: user.email, emailVerified: user.emailVerified === true } : null;
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
  devices?: DeviceLicenses,
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
    const device = readDevice((name) => context.req.header(name));
    const reply = await issueLicense(labs, signing, owner, device);
    // Eşitleme 360 Labs'a her istekte sormaz; cihazın son lisans sonucu burada saklanır.
    if (devices && device) {
      if ('claims' in reply.body) {
        const { validUntil, blocked, plan } = reply.body.claims;
        await devices.record(owner.id, device.id, { state: 'active', validUntil, blocked, hasPlan: plan !== null });
      } else if (reply.status === 403 && reply.body.device) {
        await devices.record(owner.id, device.id, { state: reply.body.device, validUntil: null, blocked: false, hasPlan: false });
      }
    }
    return context.json(reply.body, reply.status);
  });
}
