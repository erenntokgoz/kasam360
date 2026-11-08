import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { Hono } from 'hono';
import type { Auth } from './lib/auth.js';
import type { SupportConfig } from './support.js';

// Kasa internetsiz de çalışır; bu yüzden lisans her satışta sorulmaz. Cihaz imzalı belgeyi
// saklar ve gömülü açık anahtarla kendisi doğrular. Tolerans belgeye yazılır ki cihaz ile
// sunucu aynı kuralı okusun.
export const GRACE_HOURS = 72;
const day = /^\d{4}-\d{2}-\d{2}$/;

// Paket, cihazda hangi özelliklerin açılacağını ve kaç cihazın bağlanabileceğini söyler.
export interface LicensePlan {
  name: string;
  features: string[];
  deviceLimit: number;
}

export interface LicenseClaims {
  v: 1;
  product: 'kasam360';
  sub: string;
  email: string;
  /** Belge yalnız bu cihazda geçerlidir. */
  deviceId: string;
  validUntil: string | null;
  blocked: boolean;
  plan: LicensePlan | null;
  issuedAt: string;
  graceHours: number;
}

const featureCode = /^[a-z0-9_]{1,48}$/;
const deviceCode = /^[A-Za-z0-9_-]{8,64}$/;

// 360 Labs cihaz kaydının sonucu; yalnız `active` cihaz belge alır.
const DEVICE_MESSAGES: Record<string, string> = {
  limit: 'Paketin cihaz limiti dolu. Panelden başka bir cihazı kaldırın.',
  revoked: 'Bu cihaz işletme hesabından kaldırıldı.',
  unlicensed: 'Bu hesap için etkin bir paket yok.',
};

// Panelden gelen paket tam doğrulanır; bozuk bir alan varsa belge hiç üretilmez.
// Alan yoksa paket atanmamış sayılır ve cihaz hiçbir özelliği açmaz.
export function readPlan(value: unknown): LicensePlan | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return undefined;
  const plan = value as Record<string, unknown>;
  const { name, features, device_limit: deviceLimit } = plan;
  if (typeof name !== 'string' || !name || !Array.isArray(features) ||
      !features.every((code) => typeof code === 'string' && featureCode.test(code)) ||
      typeof deviceLimit !== 'number' || !Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 999) {
    return undefined;
  }
  return { name, features: features as string[], deviceLimit };
}

/** Anahtar PKCS#8 DER'in base64 hâlidir; yalnız Ed25519 kabul edilir. */
export function signingKey(raw: string): KeyObject {
  const key = createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('LICENSE_SIGNING_KEY Ed25519 olmalı.');
  return key;
}

export function signClaims(claims: LicenseClaims, key: KeyObject): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}

export interface LicenseSubject {
  id: string;
  email: string;
}

export interface LicenseReply {
  status: 200 | 400 | 403 | 502 | 503;
  body: { token: string; claims: LicenseClaims } | { message: string; device?: string };
}

/** İstekteki cihaz başlıkları okunur; kimliksiz istek belge almaz. */
export function readDevice(header: (name: string) => string | undefined) {
  const id = header('x-device-id') ?? '';
  const name = [...(header('x-device-name') ?? '').trim()].slice(0, 80).join('') || 'Kasa';
  return deviceCode.test(id) ? { id, name } : null;
}

// Lisans kaynağı 360 Labs'tır; ödeme sağlayıcısı ne olursa olsun yalnız bitiş günü okunur.
// Web oturumu ve masaüstü lisans anahtarı aynı yoldan belge alır.
export async function issueLicense(
  labs: SupportConfig | undefined,
  key: KeyObject | undefined,
  subject: LicenseSubject,
  device: { id: string; name: string } | null,
): Promise<LicenseReply> {
  if (!labs || !key) return { status: 503, body: { message: 'Lisans bağlantısı şu anda kapalı.' } };
  if (!device) return { status: 400, body: { message: 'Cihaz kimliği geçersiz.' } };
  const failed: LicenseReply = { status: 502, body: { message: 'Lisans şu anda doğrulanamadı.' } };
  const upstream = await fetch(new URL('/api/v1/urunler/kasam360/lisans', labs.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${labs.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: subject.email, account: subject.id, device }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  // Lisans sorgusu yanıtsız kalırsa belge üretilmez; cihaz elindeki son belgeyle devam eder.
  if (!upstream?.ok) return failed;
  const data: unknown = await upstream.json().catch(() => null);
  if (!data || typeof data !== 'object' || !('blocked' in data) || typeof data.blocked !== 'boolean' ||
      !('valid_until' in data) || !(data.valid_until === null ||
      (typeof data.valid_until === 'string' && day.test(data.valid_until)))) {
    return failed;
  }
  const plan = readPlan('package' in data ? data.package : undefined);
  if (plan === undefined) return failed;
  const state = 'device' in data ? data.device : undefined;
  if (state !== 'active') {
    const message = typeof state === 'string' ? DEVICE_MESSAGES[state] : undefined;
    return message ? { status: 403, body: { message, device: state as string } } : failed;
  }
  const claims: LicenseClaims = {
    v: 1,
    product: 'kasam360',
    sub: subject.id,
    email: subject.email,
    deviceId: device.id,
    validUntil: data.valid_until,
    blocked: data.blocked,
    plan,
    issuedAt: new Date().toISOString(),
    graceHours: GRACE_HOURS,
  };
  return { status: 200, body: { token: signClaims(claims, key), claims } };
}

export function mountLicense(app: Hono, auth: Auth, labs?: SupportConfig, key?: KeyObject) {
  app.get('/api/license', async (context) => {
    context.header('Cache-Control', 'no-store');
    if (!labs || !key) return context.json({ message: 'Lisans bağlantısı şu anda kapalı.' }, 503);
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ message: 'Lisans için giriş yapın.' }, 401);
    if (!session.user.emailVerified) return context.json({ message: 'Önce e-postanızı doğrulayın.' }, 403);
    const reply = await issueLicense(labs, key, session.user, readDevice((name) => context.req.header(name)));
    return context.json(reply.body, reply.status);
  });
}
