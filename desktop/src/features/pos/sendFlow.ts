/** Mutfağa gönderim sonrası ekran akışı. Başarısızlıkta hiçbir şey yapılmaz: adisyon ekranda
 * kalır, taslak durur ve başarı bildirimi gösterilmez; hata kaynağın kendi alanında okunur. */
export interface SendFlowDeps {
  send: () => Promise<boolean>;
  ringBell: () => void;
  goToFloor: () => void;
  refreshFloor: () => Promise<void>;
  notifySuccess: (message: string) => void;
  /** Mutfak ekranı yoksa (etkin KITCHEN kullanıcısı yok) zil çalmaz, mesaj yalnız kaydı söyler. */
  hasKitchenScreen?: boolean;
}

export const KITCHEN_SENT_MESSAGE = 'Sipariş kaydedildi, fiş gönderildi.';
export const ORDER_SAVED_MESSAGE = 'Sipariş kaydedildi.';

export async function sendAndReturnToFloor(deps: SendFlowDeps): Promise<boolean> {
  const sent = await deps.send();
  if (!sent) return false;
  const screen = deps.hasKitchenScreen ?? true;
  if (screen) deps.ringBell();
  // Salon kendi girişinde de tazelenir; okuma gecikmesi dönüşü bekletmesin.
  deps.goToFloor();
  deps.notifySuccess(screen ? KITCHEN_SENT_MESSAGE : ORDER_SAVED_MESSAGE);
  void deps.refreshFloor().catch(() => undefined);
  return true;
}
