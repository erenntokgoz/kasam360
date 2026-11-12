import { invokeIPC } from '../services/tauriClient';
import { usePrintAlertStore } from '../stores/printAlertStore';

interface KitchenPrintReport {
  printedStations: string[];
  problems: string[];
}

/**
 * Kaydedilen kalemlerin istasyon fişini basar. Sipariş bu noktada zaten kayıtlıdır;
 * basım hatası akışı bozmaz, kalıcı uyarıya dönüşür.
 */
export async function printKitchenTickets(
  orderId: string | null,
  itemIds: string[],
  actorRole: string | undefined,
  tenantId: string | undefined,
): Promise<void> {
  if (!orderId || itemIds.length === 0) return;
  try {
    const report = await invokeIPC<KitchenPrintReport | null>('print_kitchen_ticket', { orderId, itemIds, actorRole, tenantId });
    if (report && report.problems.length > 0) {
      usePrintAlertStore.getState().report(report.problems.map((problem) => `Fiş basılamadı, sipariş kayıtlı. ${problem}`));
    }
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    usePrintAlertStore.getState().report([`Fiş yazıcıya gönderilemedi, sipariş kayıtlı: ${reason}`]);
  }
}
