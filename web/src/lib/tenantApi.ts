// İşletme uçları oturum çerezini kullanır; hata gövdesindeki mesaj kullanıcıya aynen taşınır,
// böylece yetkisiz/eksik kayıt durumu genel bir hata metniyle gizlenmez.
export class TenantRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function tenantRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init });
  } catch {
    throw new TenantRequestError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message : 'İşletme bilgisi alınamadı.';
    throw new TenantRequestError(message, response.status);
  }
  return body as T;
}
