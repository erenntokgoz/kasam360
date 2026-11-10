import { useShiftStore } from '../../../stores/shiftStore';

/**
 * Personel ödemesi nakitse kasadan çıkar; Kasa ekranı açık kalan bileşende eski beklenen
 * nakdi göstermesin diye ödemeden sonra vardiya özeti yeniden okunur.
 */
export function refreshCashAfterPayout(): void {
  void useShiftStore.getState().loadShiftData();
}
