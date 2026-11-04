const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-posta veya şifre hatalı.',
  INVALID_PASSWORD: 'Mevcut şifreniz hatalı.',
  INVALID_EMAIL: 'Geçerli bir e-posta adresi yazın.',
  EMAIL_NOT_VERIFIED: 'E-postanız doğrulanmadı. Doğrulama bağlantısını yeniden gönderdik.',
  PASSWORD_TOO_SHORT: 'Şifre en az 8 karakter olmalı.',
  PASSWORD_TOO_LONG: 'Şifre en fazla 128 karakter olabilir.',
  INVALID_TOKEN: 'Bağlantı geçersiz veya süresi dolmuş. Yeni bağlantı isteyin.',
  PROVIDER_NOT_FOUND: 'Google ile giriş şu anda kapalı.',
};

export type FieldErrors = Record<string, string>;

export interface AuthResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errors?: FieldErrors;
}

// Sunucudan gelen hata metni İngilizcedir; ekrana yalnız Türkçe karşılığı çıkar.
async function readResponse<T>(response: Response): Promise<AuthResult<T>> {
  const body = (await response.json().catch(() => null)) as (T & { code?: string; errors?: FieldErrors }) | null;
  if (response.ok) return { ok: true, data: body ?? undefined };
  if (body?.errors) return { ok: false, errors: body.errors };
  if (response.status === 429) return { ok: false, error: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.' };
  return { ok: false, error: MESSAGES[body?.code ?? ''] ?? 'İşlem tamamlanamadı. Biraz sonra tekrar deneyin.' };
}

async function request<T>(path: string, init?: RequestInit): Promise<AuthResult<T>> {
  try {
    return await readResponse<T>(await fetch(`/api/auth${path}`, init));
  } catch {
    return { ok: false, error: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.' };
  }
}

export const authGet = <T>(path: string) => request<T>(path);

export const authPost = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
