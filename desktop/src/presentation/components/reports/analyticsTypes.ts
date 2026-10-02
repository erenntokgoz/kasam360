/**
 * Faz 10 analitik arayüz tipleri.
 *
 * Neden ayrı dosya: backend `analytics_commands::metrics` DTO'larıyla **birebir**
 * aynı alan adlarını taşır. Böylece DTO eşleme katmanı (elle yazılan
 * `map` fonksiyonları) yoktur; gelen JSON doğrudan bu tiplere oturur.
 *
 * Finansal kural (AGENTS.md §3.4): `unit_cost_cents`, `gross_profit_cents`,
 * `margin_percent`, `achieved_percent` ve `void_rate_percent` **null** olabilir.
 * Arayüzde `null` "Bilinmiyor" olarak gösterilir; 0'a çevrilmez.
 */

export type BcgQuadrant = 'Star' | 'Plowhorse' | 'CashCow' | 'Dog';

export interface ProductMargin {
  product_id: string;
  product_name: string;
  category_name: string;
  units_sold: number;
  revenue_cents: number;
  /** FIFO partisi yoksa `null`: maliyet bilinmiyor. */
  unit_cost_cents: number | null;
  gross_profit_cents: number | null;
  margin_percent: number | null;
}

export interface BcgEntry {
  product_id: string;
  product_name: string;
  quadrant: BcgQuadrant;
  quadrant_label: string;
  units_sold: number;
  margin_percent: number | null;
}

export interface BcgCounts {
  star: number;
  plowhorse: number;
  cash_cow: number;
  dog: number;
}

export interface ProductCombination {
  product_a_id: string;
  product_a_name: string;
  product_b_id: string;
  product_b_name: string;
  support: number;
  confidence_percent: number;
}

export interface PeakHourBucket {
  /** 0-23 */
  hour: number;
  revenue_cents: number;
  orders: number;
}

export interface MonthlyTargetStatus {
  /** `YYYY-MM` */
  month: string;
  category: string;
  target_cents: number;
  actual_cents: number;
  difference_cents: number;
  /** Hedef 0 ise `null`: oran hesaplanamaz. */
  achieved_percent: number | null;
}

export interface CompetitorPriceGap {
  product_id: string;
  product_name: string;
  competitor_name: string;
  our_price_cents: number;
  competitor_price_cents: number;
  /** `bizim - rakip`. Negatifse biz daha pahalıyız. */
  gap_cents: number;
  gap_percent: number;
  observed_at: string;
}

export interface VoidLossRate {
  voided_cents: number;
  total_cents: number;
  /** Toplam ciro 0 ise `null`: hesaplanamaz, 0 sanılmaz. */
  void_rate_percent: number | null;
  voided_orders: number;
  total_orders: number;
}

export interface AnalyticsMetrics {
  from: string | null;
  to: string | null;
  currency: string;
  product_margins: ProductMargin[];
  bcg_matrix: BcgEntry[];
  bcg_counts: BcgCounts;
  combinations: ProductCombination[];
  peak_hours: PeakHourBucket[];
  monthly_targets: MonthlyTargetStatus[];
  competitor_gaps: CompetitorPriceGap[];
  void_loss: VoidLossRate | null;
}

/** Komuta giden tarih aralığı: her iki uç da aynı anda verilir. */
export interface AnalyticsRangeRequest {
  from: string | null;
  to: string | null;
}

export interface MonthTargetInput {
  /** `YYYY-MM` */
  month: string;
  category: string;
  target_cents: number;
}

export interface CompetitorPriceInput {
  product_id: string;
  competitor_name: string;
  price_cents: number;
}

/** `2026-03` biçimini ay anahtarına çevirir; geçersizse boş döner. */
export function formatMonthKey(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

/** Kuruşu TL metnine çevirir; yalnız gösterim içindir. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${sign === '' ? '' : ''}₺${(abs / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** `null` yüzdeyi "Bilinmiyor" olarak gösterir; 0 değeri 0 olarak kalır. */
export function formatPercent(value: number | null): string {
  return value === null ? 'Bilinmiyor' : `%${value}`;
}