const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://kasam360.com.tr';

export interface WebAccount {
  name: string;
  email: string;
  businessName?: string | null;
  phone?: string | null;
}

export type AccountFieldErrors = Record<string, string>;

export interface AccountResult<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
  errors?: AccountFieldErrors;
}

const NO_CONNECTION = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.';

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-posta veya şifre hatalı.',
  EMAIL_NOT_VERIFIED: 'E-postanız doğrulanmadı.',
  INVALID_EMAIL: 'Geçerli bir e-posta adresi yazın.',
  PASSWORD_TOO_SHORT: 'Şifre en az 8 karakter olmalı.',
  PASSWORD_TOO_LONG: 'Şifre en fazla 128 karakter olabilir.',
  INVALID_OTP: 'Kod hatalı.',
  OTP_EXPIRED: 'Kodun süresi doldu. Yeni kod isteyin.',
  TOO_MANY_ATTEMPTS: 'Çok fazla hatalı deneme. Yeni kod isteyin.',
};

/** Hesap sunucuda durur; ekrana sunucunun İngilizce metni değil Türkçe karşılığı çıkar. */
export async function accountPost<T>(path: string, body: unknown): Promise<AccountResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${SITE_URL}/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: NO_CONNECTION };
  }
  const data = (await response.json().catch(() => null)) as (T & { code?: string; errors?: AccountFieldErrors }) | null;
  if (response.ok) return { ok: true, status: response.status, data: data ?? undefined };
  if (data?.errors) return { ok: false, status: response.status, errors: data.errors };
  if (response.status === 429) return { ok: false, status: 429, error: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.' };
  return { ok: false, status: response.status, error: MESSAGES[data?.code ?? ''] ?? NO_CONNECTION };
}

export class EmailNotVerified extends Error {}

/** Web hesabını yalnız kurulumda doğrular; sonraki girişler yerel özetle internetsiz çalışır. */
export async function verifyWebAccount(email: string, password: string): Promise<WebAccount> {
  const result = await accountPost<{ user: WebAccount }>('/sign-in/email', { email, password });
  if (result.ok && result.data) return result.data.user;
  if (result.status === 403) throw new EmailNotVerified();
  throw new Error(result.error ?? NO_CONNECTION);
}

/** Tarayıcıda seçilen Google hesabını okur; henüz sonuç yoksa boş döner. */
export async function readDesktopLink(code: string): Promise<WebAccount | null> {
  const response = await fetch(`${SITE_URL}/api/desktop-link/${code}`, { credentials: 'omit' }).catch(() => null);
  return response?.status === 200 ? ((await response.json()) as WebAccount) : null;
}
