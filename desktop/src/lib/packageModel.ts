import type { PackageDelivery, PackagePayment, PackageStatus } from '../types/packageService';
import type { OrderItemModifier } from '../types/pos';

/** Gecikme eşikleri (dakika): her aşama kendi sınırına göre vurgulanır. */
export const LATE_MINUTES: Partial<Record<PackageStatus, number>> = {
  PREPARING: 20,
  READY: 10,
  ON_ROUTE: 30,
};

export const STATUS_LABEL: Record<PackageStatus, string> = {
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  ON_ROUTE: 'Yolda',
  DELIVERED: 'Teslim edildi',
  CANCELLED: 'İptal',
};

export const PAYMENT_LABEL: Record<PackagePayment, string> = {
  CASH: 'Kapıda nakit',
  CARD: 'Kapıda kart',
  ONLINE: 'Online ödendi',
};

/** Tahta sütunları; iptal tahtada değil geçmiş listesinde görünür. */
export const BOARD_COLUMNS: PackageStatus[] = ['PREPARING', 'READY', 'ON_ROUTE', 'DELIVERED'];

/** Aşamanın başladığı an; süre bu andan sayılır. */
export function stageStart(row: PackageDelivery): string {
  switch (row.status) {
    case 'READY': return row.readyAt ?? row.createdAt;
    case 'ON_ROUTE': return row.dispatchedAt ?? row.readyAt ?? row.createdAt;
    case 'DELIVERED': return row.deliveredAt ?? row.createdAt;
    default: return row.createdAt;
  }
}

export function minutesSince(iso: string, now: number): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 60_000));
}

/** Süre metni: 7 dk, 1 sa 05 dk. */
export function durationText(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} dk`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} sa ${String(totalMinutes % 60).padStart(2, '0')} dk`;
}

/** Saniyeyi süre metnine çevirir; ölçülemeyen süre "—" görünür. */
export function secondsText(seconds: number | null): string {
  return seconds === null ? '—' : durationText(Math.round(seconds / 60));
}

/** Aşama süresi sınırı aşmışsa gecikme dakikası, aksi halde `null`. */
export function lateMinutes(row: PackageDelivery, now: number): number | null {
  const limit = LATE_MINUTES[row.status];
  if (limit === undefined) return null;
  const elapsed = minutesSince(stageStart(row), now);
  return elapsed > limit ? elapsed - limit : null;
}

/** Siparişin sunucudan gelen bir sonraki adımı; kurye yalnız yolda ve teslim adımlarını görür. */
export function nextStatus(row: PackageDelivery): PackageStatus | null {
  switch (row.status) {
    case 'PREPARING': return 'READY';
    case 'READY': return 'ON_ROUTE';
    case 'ON_ROUTE': return 'DELIVERED';
    default: return null;
  }
}

export const NEXT_LABEL: Partial<Record<PackageStatus, string>> = {
  READY: 'Hazır',
  ON_ROUTE: 'Yola çıkar',
  DELIVERED: 'Teslim edildi',
};

/** Kısa sipariş kodu: kimliğin son dört hanesi, fişte ve telefonda söylenebilir. */
export function orderCode(id: string): string {
  return id.slice(-4).toUpperCase();
}

/** Kuryeden alınacak para: yalnız teslim edilmiş ve mutabakatı yapılmamış kapıda tahsilatlılar. */
export function awaitingSettlement(rows: PackageDelivery[], courierId: string): PackageDelivery[] {
  return rows.filter(
    (row) =>
      row.courierId === courierId &&
      row.status === 'DELIVERED' &&
      row.settledAt === null &&
      row.paymentMethod !== 'ONLINE',
  );
}

export function settlementTotals(rows: PackageDelivery[]): { cashCents: number; cardCents: number } {
  let cashCents = 0;
  let cardCents = 0;
  for (const row of rows) {
    if (row.paymentMethod === 'CASH') cashCents += row.totalCents;
    if (row.paymentMethod === 'CARD') cardCents += row.totalCents;
  }
  return { cashCents, cardCents };
}

/** Telefon numarasını 0532 111 22 33 biçiminde gösterir; tanınmayan biçim olduğu gibi kalır. */
export function phoneText(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 11) return phone;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

export interface PackageCartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  note: string;
  /** Seçilen seçenekler; fiyat farkı yalnız gösterim içindir, sunucu seçenek kimliğinden hesaplar. */
  modifiers?: OrderItemModifier[];
}

/** Aynı ürünün farklı seçenek/not kombinasyonları ayrı satırdır. */
export function lineKey(line: Pick<PackageCartLine, 'productId' | 'modifiers' | 'note'>): string {
  const options = (line.modifiers ?? []).map((modifier) => modifier.optionId).sort().join(',');
  return `${line.productId}|${options}|${line.note.trim()}`;
}

export function cartSubtotalCents(lines: PackageCartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/** Kaydı engelleyen ilk neden; boşsa kayıt yapılabilir. Müşterisiz paket siparişi reddedilir. */
export function packageOrderBlocker(input: {
  hasCustomer: boolean;
  addressId: string;
  lineCount: number;
  feeValid: boolean;
}): string | null {
  if (!input.hasCustomer) return 'Önce müşteri seçin.';
  if (input.addressId === '') return 'Teslimat adresini seçin.';
  if (input.lineCount === 0) return 'Sepete en az bir ürün ekleyin.';
  if (!input.feeValid) return 'Teslimat ücreti geçerli bir tutar olmalı.';
  return null;
}

/** Sunucu kalem sözleşmesi: fiyat gönderilmez, sunucu hesaplar. */
export function toSubmitLines(lines: PackageCartLine[]) {
  return lines.map((line, index) => ({
    id: `drf_${index}_${line.productId}`,
    product: { id: line.productId },
    quantity: line.quantity,
    modifiers: (line.modifiers ?? []).map((modifier) => ({ id: modifier.optionId })),
    note: line.note.trim() || null,
  }));
}
