/** Mutfağa gönderim sonrası ekran akışı. Başarısızlıkta hiçbir şey yapılmaz: adisyon ekranda
 * kalır, taslak durur ve başarı bildirimi gösterilmez; hata kaynağın kendi alanında okunur. */
export interface SendFlowDeps {
  send: () => Promise<boolean>;
  ringBell: () => void;
  goToFloor: () => void;
  refreshFloor: () => Promise<void>;
  notifySuccess: (message: string) => void;
}

export const KITCHEN_SENT_MESSAGE = 'Sipariş mutfağa iletildi.';

export async function sendAndReturnToFloor(deps: SendFlowDeps): Promise<boolean> {
  const sent = await deps.send();
  if (!sent) return false;
  deps.ringBell();
  // Salon kendi girişinde de tazelenir; okuma gecikmesi dönüşü bekletmesin.
  deps.goToFloor();
  deps.notifySuccess(KITCHEN_SENT_MESSAGE);
  void deps.refreshFloor().catch(() => undefined);
  return true;
}
