import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

/** Labs `kasam360.mail.v1` sözleşmesi: ürüne atanmış (yoksa varsayılan) gönderim hesabı. */
export const MAIL_CONTRACT = 'kasam360.mail.v1' as const;

export interface MailAccount {
  accountId: string;
  source: 'product' | 'default' | 'env';
  host: string;
  port: number;
  security: 'ssl' | 'starttls' | 'none';
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface MailerOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  createTransport?: typeof nodemailer.createTransport;
  now?: () => number;
  /** Labs yanıtı bu süre taze sayılır; her postada Labs'a gidilmez. */
  freshMs?: number;
  /** Labs ulaşılamazsa son doğrulanmış hesap en çok bu süre kullanılır. */
  staleMs?: number;
  retryDelayMs?: number;
}

type Lookup =
  | { kind: 'account'; account: MailAccount }
  | { kind: 'none' }
  | { kind: 'unavailable' };

const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const hasText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\0]/.test(value);

// Labs yanıtı kesin şemaya uymak zorundadır; bozuk yanıt eksik alanla tamamlanmaz.
function parseAccount(value: unknown): MailAccount | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const security = v.security;
  if (v.contract !== MAIL_CONTRACT || (v.source !== 'product' && v.source !== 'default')) return null;
  if (security !== 'ssl' && security !== 'starttls' && security !== 'none') return null;
  if (!hasText(v.accountId, 64) || !hasText(v.host, 253) || !hasText(v.username, 254) || !hasText(v.password, 256)) return null;
  if (!hasText(v.fromAddress, 254) || !/^[^\s@<>]+@[^\s@<>]+$/.test(v.fromAddress)) return null;
  if (typeof v.fromName !== 'string' || v.fromName.length > 80 || /[\r\n\0<>"]/.test(v.fromName)) return null;
  if (typeof v.port !== 'number' || !Number.isInteger(v.port) || v.port < 1 || v.port > 65535) return null;
  // Şifresiz bağlantı yalnız yerel sunucuya izinlidir; Labs de aynı kuralı uygular.
  if (security === 'none' && !LOOPBACK.has(v.host)) return null;
  return {
    accountId: v.accountId, source: v.source, host: v.host, port: v.port, security,
    username: v.username, password: v.password, fromName: v.fromName, fromAddress: v.fromAddress,
  };
}

class MailConfigError extends Error {}

export function createMailer(options: MailerOptions = {}): SendMail {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const createTransport = options.createTransport ?? nodemailer.createTransport;
  const now = options.now ?? Date.now;
  const freshMs = options.freshMs ?? 60_000;
  const staleMs = options.staleMs ?? 15 * 60_000;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  let cached: { account: MailAccount; at: number } | undefined;

  async function lookup(): Promise<Lookup> {
    const origin = (env.LABS_CATALOG_ORIGIN ?? '').replace(/\/$/, '');
    const token = env.LABS_CATALOG_TOKEN ?? '';
    if (!origin || !token) return { kind: 'none' };
    if (cached && now() - cached.at < freshMs) return { kind: 'account', account: cached.account };
    let response: Response;
    try {
      response = await fetcher(`${origin}/api/v1/urunler/kasam360/posta-hesabi`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      console.error('Labs posta hesabı okunamadı (bağlantı):', error instanceof Error ? error.message : 'bilinmeyen hata');
      return { kind: 'unavailable' };
    }
    if (response.status === 404) {
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      if (body?.code === 'MAIL_ACCOUNT_NOT_CONFIGURED') { cached = undefined; return { kind: 'none' }; }
      return { kind: 'unavailable' };
    }
    if (response.status !== 200) {
      console.error(`Labs posta hesabı okunamadı (durum ${response.status}).`);
      return { kind: 'unavailable' };
    }
    const account = parseAccount(await response.json().catch(() => null));
    // Sözleşmeye uymayan 200 yanıtı yapılandırma hatasıdır; yedek hesaba sessizce kaymaz.
    if (!account) throw new MailConfigError('Labs posta hesabı yanıtı geçersiz.');
    cached = { account, at: now() };
    return { kind: 'account', account };
  }

  async function deliver(account: MailAccount, mail: Mail): Promise<void> {
    const transport = createTransport({
      host: account.host,
      port: account.port,
      secure: account.security === 'ssl',
      requireTLS: account.security === 'starttls',
      ignoreTLS: account.security === 'none',
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const message = {
      from: account.fromName ? { name: account.fromName, address: account.fromAddress } : account.fromAddress,
      to: mail.to, subject: mail.subject, text: mail.text,
    };
    try {
      await transport.sendMail(message);
    } catch (error) {
      // Kimlik reddi tekrarla düzelmez; anlık DNS/bağlantı hatası ise doğrulama mailini kaybettirmesin.
      if ((error as { code?: string }).code === 'EAUTH') throw error;
      console.error('Mail ilk denemede gönderilemedi:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      await transport.sendMail(message);
    }
  }

  function envAccount(): MailAccount | null {
    const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM } = env;
    if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM) return null;
    return {
      accountId: 'env', source: 'env', host: SMTP_HOST, port: Number(SMTP_PORT ?? 465),
      security: SMTP_SECURITY === 'ssl' ? 'ssl' : 'starttls', username: SMTP_USERNAME, password: SMTP_PASSWORD,
      fromName: 'KASAM360', fromAddress: SMTP_FROM,
    };
  }

  function writeDevMail({ to, subject, text }: Mail): boolean {
    // Yalnız yerel başlatıcı DEV_MAIL_DIR verir: posta gerçek kutuya gitmez, dosyaya yazılır ve logda
    // açıkça belirtilir. Üretimde bu yol kapalıdır; eksik hesap yine hata olarak döner.
    const devDir = env.DEV_MAIL_DIR;
    if (!devDir || env.NODE_ENV === 'production') return false;
    mkdirSync(devDir, { recursive: true });
    const file = path.join(devDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${to.replace(/[^a-z0-9@._-]/gi, '_')}.txt`);
    writeFileSync(file, `Kime: ${to}\nKonu: ${subject}\n\n${text}\n`, 'utf8');
    console.warn(`[YEREL POSTA] SMTP yok; posta gönderilmedi, dosyaya yazıldı: ${file}`);
    return true;
  }

  return async (mail) => {
    // Öncelik: Labs'ın ürüne atadığı hesap. Gerekçe: parola, gönderen ve hesap değişimi tek yerden
    // yönetilir; env yalnız Labs'ın "hesap yok" dediği ya da erişilemediği durumda yedektir.
    const found = await lookup();
    if (found.kind === 'account') {
      try {
        await deliver(found.account, mail);
      } catch (error) {
        // Atanmış hesap reddediliyorsa yedeğe kaymaz ve başarı dönmez; sonraki istek hesabı yeniden okur.
        cached = undefined;
        throw error;
      }
      return;
    }
    if (found.kind === 'unavailable' && cached && now() - cached.at < staleMs) {
      console.warn('Labs ulaşılamıyor; son doğrulanmış posta hesabı kullanılıyor.');
      await deliver(cached.account, mail);
      return;
    }
    const fallback = envAccount();
    if (fallback) {
      await deliver(fallback, mail);
      return;
    }
    if (writeDevMail(mail)) return;
    throw new Error('SMTP ayarları eksik.');
  };
}

// Eksik yapılandırma başarı sayılmaz; hata çağırana taşınır.
export const sendSmtpMail: SendMail = createMailer();
