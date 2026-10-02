/**
 * Birleşik rapor merkezinin arayüz tipleri.
 *
 * Neden ayrı dosya: `OwnerSalesTab` ve `ReportsPanel` aynı veriyi farklı
 * gömülü tiplerle (biri `total_cents`, diğeri `total_revenue_cents`) okuyordu.
 * Buradaki tipler backend `report_service` DTO'larıyla **birebir** aynı alan
 * adlarını taşır; böylece iki yüzey tek tipe bağlanır.
 *
 * Tutarlar her zaman kuruş (`*_cents`) olarak taşınır. Gösterim dönüşümü
 * yalnızca `MoneyDisplay` ve `reportExport` içinde yapılır.
 */

export interface PaymentMethodShare {
  method: string;
  amount_cents: number;
  /** Yüzde, tam sayı (0-100). */
  share_percent: number;
}

export interface CategoryVolume {
  name: string;
  quantity: number;
  total_cents: number;
}

export interface SalesReport {
  total_revenue_cents: number;
  total_orders: number;
  average_order_value_cents: number;
  voided_cents: number;
  payment_methods: PaymentMethodShare[];
  category_volume: CategoryVolume[];
  from: string;
  to: string;
}

export interface ShiftReportRow {
  id: string;
  cashier_id: string;
  cashier_name: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  expected_amount_cents: number;
  actual_amount_cents: number | null;
  difference_cents: number | null;
}

export interface ReceiptReportRow {
  id: string;
  table_id: string;
  total_cents: number;
  created_at: string;
  cashier_id: string | null;
  status: string;
  item_count: number;
  items_total_cents: number;
}

/** `VOID` | `REFUND` | `WASTE` */
export type AdjustmentKind = 'VOID' | 'REFUND' | 'WASTE';

export interface AdjustmentRow {
  kind: string;
  resource_id: string;
  amount_cents: number;
  reason: string;
  actor_id: string;
  approver_id: string;
  approver_role: string;
  occurred_at: string;
}

export interface AdjustmentsReport {
  rows: AdjustmentRow[];
  /**
   * Kaydı bulunmayan hareket türleri. Arayüz "kayıt yok" der; sıfır tutar
   * uydurmaz (yazma yolu olmayan hareketlerde bu liste doludur).
   */
  kinds_without_records: string[];
}

export type ReportRangePresetId = 'today' | 'last7' | 'last30' | 'custom';

export interface ReportRange {
  /** ISO-8601 başlangıç (dahil). */
  from: string;
  /** ISO-8601 bitiş (dahil). */
  to: string;
}

export interface ReportRangePreset {
  id: ReportRangePresetId;
  label: string;
}

export const REPORT_RANGE_PRESETS: readonly ReportRangePreset[] = [
  { id: 'today', label: 'Bugün' },
  { id: 'last7', label: 'Son 7 gün' },
  { id: 'last30', label: 'Son 30 gün' },
  { id: 'custom', label: 'Özel aralık' },
];

const DAY_MS = 86_400_000;

/** Yerel saati gün başına çevirir: `new Date(y, m, d)` 00:00 yereldir. */
function startOfLocalDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
}

function toIso(date: Date): string {
  return date.toISOString();
}

/**
 * Hazır aralıkları **yerel** gün sınırlarına göre üretir.
 *
 * Neden `toISOString` ile UTC'ye çevirme: rapor "bugün" dediğinde işletmenin
 * kendi günü kastedilir; UTC'ye kaydırılan aralık akşam vardiyasını yarın
 * sabaha taşırdı.
 */
export function buildPresetRange(
  preset: Exclude<ReportRangePresetId, 'custom'>,
  now: Date = new Date(),
): ReportRange {
  const end = endOfLocalDay(now);
  if (preset === 'today') {
    return { from: toIso(startOfLocalDay(now)), to: toIso(end) };
  }
  const days = preset === 'last7' ? 7 : 30;
  const start = startOfLocalDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return { from: toIso(start), to: toIso(end) };
}

/** `<input type="date">` değerini aralığın başlangıcına çevirir. */
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Tarih girdisini gün başı / gün sonu ISO değerine çevirir. */
export function fromDateInput(
  startValue: string,
  endValue: string,
): ReportRange | { error: string } {
  if (!startValue || !endValue) {
    return { error: 'Başlangıç ve bitiş tarihi seçilmelidir.' };
  }
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Tarihler okunamadı.' };
  }
  if (end.getTime() < start.getTime()) {
    return { error: 'Bitiş tarihi başlangıçtan önce olamaz.' };
  }
  return { from: toIso(start), to: toIso(end) };
}

/** Aralık uzunluğunu gün cinsinden döndürür (yalnız etiket için). */
export function rangeDayCount(range: ReportRange): number {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 1;
  return Math.floor((to - from) / DAY_MS) + 1;
}

export const ADJUSTMENT_KIND_LABELS: Readonly<Record<string, string>> = {
  VOID: 'İptal',
  REFUND: 'İade',
  WASTE: 'Zayi',
};

/** Ödeme yöntemi kodunu arayüz diline çevirir; bilinmeyen kod olduğu gibi kalır. */
export function paymentMethodLabel(method: string): string {
  const value = method.trim();
  const lower = value.toLowerCase();
  if (lower.includes('cash') || value === 'Nakit') return 'Nakit';
  if (lower.includes('credit') || value.includes('Kart')) return 'Kredi Kartı';
  if (lower.includes('bank') || lower.includes('havale')) return 'Banka Havalesi';
  if (lower.includes('split') || value.includes('Parçalı')) return 'Parçalı Ödeme';
  return value.length > 0 ? value : 'Bilinmiyor';
}
