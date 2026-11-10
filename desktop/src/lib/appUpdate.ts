/** Masaüstü güncelleme durumu: arayüz kararları ağdan ve IPC'den bağımsız burada. */

export type UpdateStatus = 'UNCONFIGURED' | 'UP_TO_DATE' | 'AVAILABLE' | 'OFFLINE' | 'ERROR';

export interface UpdateCheck {
  currentVersion: string;
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  message: string | null;
}

export interface OpenWork {
  hasOpenShift: boolean;
}

export type UpdateNotice =
  | { kind: 'none' }
  | { kind: 'ready'; version: string; canInstall: boolean; blockedReason: string | null };

export const BLOCKED_BY_SHIFT = 'Açık vardiya var; vardiyayı kapattıktan sonra kurulabilir.';

/**
 * Bildirim kararı. Kurulum hiçbir durumda kendiliğinden başlamaz; açık vardiya varken
 * düğme de kapalıdır (asıl engel backend'dedir, burası yalnız erken ve anlaşılır uyarıdır).
 */
export function planUpdateNotice(check: UpdateCheck | null, work: OpenWork, dismissedVersion: string | null): UpdateNotice {
  if (!check || check.status !== 'AVAILABLE' || !check.version) return { kind: 'none' };
  if (check.version === dismissedVersion) return { kind: 'none' };
  const blockedReason = work.hasOpenShift ? BLOCKED_BY_SHIFT : null;
  return { kind: 'ready', version: check.version, canInstall: blockedReason === null, blockedReason };
}

/** Elle denetimde kullanıcıya söylenecek tek cümle; otomatik denetimde bu metin gösterilmez. */
export function checkResultText(check: UpdateCheck): string {
  switch (check.status) {
    case 'UP_TO_DATE': return `Güncel sürümdesiniz (${check.currentVersion}).`;
    case 'AVAILABLE': return `Yeni sürüm hazır: ${check.version ?? ''}`.trim();
    case 'OFFLINE': return 'Güncelleme sunucusuna ulaşılamadı. İnternet bağlantısını kontrol edip yeniden deneyin; satış etkilenmez.';
    case 'UNCONFIGURED': return 'Bu sürümde güncelleme denetimi kapalı.';
    default: return check.message ? `Güncelleme denetlenemedi: ${check.message}` : 'Güncelleme denetlenemedi.';
  }
}
