/**
 * Faz 7 — Fiş ve finansal hareket sözleşmesi.
 *
 * Fiş **ayrı bir varlık değil**, tahsilat kaydının görünümüdür. Bu yüzden her iki
 * tip de aynı kimliği (`transaction_id`) taşır ve hareket satırındaki
 * `receipt_id` dolu olduğunda fiş görüntülenebilir.
 *
 * Alan adları backend `ReceiptDto` / `FinancialMovementDto` ile birebir aynıdır
 * (snake_case). Mock katmanı da aynı biçimi üretir.
 */

export interface ReceiptItemDto {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  tax_rate: number;
  subtotal_cents: number;
  tax_amount_cents: number;
  total_cents: number;
  modifiers?: string[];
  notes?: string | null;
}

export interface ReceiptDto {
  /** Tahsilat kimliği (`transaction_id` ile aynı). */
  id: string;
  transaction_id: string;
  /** Veritabanından türetilen mali fiş numarası; istemci değiştiremez. */
  fiscal_receipt_no?: string | null;
  order_id?: string | null;
  table_id: string;
  total_cents: number;
  /** Yalnız saklanan kalemlerden toplanır; kalem yoksa 0'dır (uydurma yok). */
  subtotal_cents: number;
  tax_total_cents: number;
  discount_cents: number;
  created_at: string;
  cashier_id?: string | null;
  cashier_name?: string | null;
  payment_method: string;
  notes?: string | null;
  items: ReceiptItemDto[];
  tendered_cents?: number | null;
  change_cents?: number | null;
  /** Kalem satırı var mı? Yanlışsa arayüz "kalem kaydı yok" der. */
  has_items: boolean;
}

export const MOVEMENT_SALE_PAYMENT = 'SALE_PAYMENT';
export const MOVEMENT_CASH_MOVEMENT = 'CASH_MOVEMENT';
export const MOVEMENT_DEBT_PAYMENT = 'DEBT_PAYMENT';

export interface FinancialMovementDto {
  movement_id: string;
  tenant_id: string;
  movement_type: string;
  /** Kuruş. Kasa çıkışı negatif işaretlidir. */
  amount_cents: number;
  payment_method: string;
  description?: string | null;
  created_at: string;
  /** Fiş varsa tahsilat kimliği; kasa/cari hareketlerinde `null`. */
  receipt_id?: string | null;
  fiscal_receipt_no?: string | null;
}

/** Hareket türünün okunabilir karşılığı (arayüz metni, tek kaynak). */
export function movementTypeLabel(movementType: string): string {
  switch (movementType) {
    case MOVEMENT_SALE_PAYMENT:
      return 'Tahsilat';
    case MOVEMENT_CASH_MOVEMENT:
      return 'Kasa Hareketi';
    case MOVEMENT_DEBT_PAYMENT:
      return 'Cari Tahsilat';
    default:
      return 'Diğer Hareket';
  }
}

/** Kuruşu `₺` biçimine çevirir; kuruş tamlığı korunur (float yok). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const lira = Math.trunc(absolute / 100);
  const kuruş = String(absolute % 100).padStart(2, '0');
  return `${sign}${lira.toLocaleString('tr-TR')},${kuruş} ₺`;
}