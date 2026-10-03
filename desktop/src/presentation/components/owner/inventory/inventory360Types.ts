// Faz 12 · Envanter 360 arayüz tipleri ve biçimlendiricileri.
//
// Neden ayrı dosya: beş panel de aynı para/birim/tarih biçimini kullanır.
// Biçimlendirme tek yerde toplanmazsa bir panel `0,00` gösterirken diğeri
// `—` gösterir ve patron iki ekran arasında tutarsızlık görür.

/** Kuruş cinsinden para. Ondalık **yoktur**; float'a çevrilmez. */
export type Cents = number;

/** Kuruşü biçimlendirir. `null` bilinmeyen tutarı temsil eder ve `—` yazar. */
export function money(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Sayıyı biçimlendirir, bilinmiyorsa `—` yazar.
 *
 * Neden `0` değil: bilinmeyen miktar `0` gösterilirse patron "stokta yok"
 * sanır; aslında "veri girilmemiş" demektir. Bu ayrım AGENTS.md §3.4'ün
 * arayüzdeki karşılığıdır.
 */
export function quantity(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return '—';
  const bicim = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
  return unit ? `${bicim.format(value)} ${unit}` : bicim.format(value);
}

/** ISO tarih damgasını kısa tarihe çevirir. Bozuk metin olduğu gibi döner. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const tarih = new Date(iso);
  if (Number.isNaN(tarih.getTime())) return iso;
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' }).format(tarih);
}

export interface EffectivePrice {
  product_id: string;
  base_price_cents: Cents;
  final_price_cents: Cents;
  source: 'FROZEN' | 'DYNAMIC_RULE' | 'PRICE_LIST' | 'PRODUCT_PRICE';
  discount_cents: Cents;
  rule_id: string | null;
  rule_name: string | null;
  is_86d: boolean;
  stockout_reason: string | null;
  service_window: string | null;
}

export interface PriceListItem {
  id: string;
  product_id: string;
  product_name: string;
  price_cents: Cents;
}

export interface PriceList {
  id: string;
  name: string;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  items: PriceListItem[];
}

export interface PricingRule {
  id: string;
  name: string;
  kind: string;
  discount_percent: number;
  start_time: string;
  end_time: string;
  days_of_week: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  priority: number;
}

export interface ServiceWindow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  product_count: number;
}

export interface BulkPriceChange {
  product_id: string;
  product_name: string;
  old_price_cents: Cents;
  new_price_cents: Cents;
  skipped: string | null;
}

export interface BulkPriceResult {
  changed: BulkPriceChange[];
  skipped: BulkPriceChange[];
  category_id: string | null;
}

export interface RecipeItem {
  id: string;
  component_product_id: string;
  component_name: string | null;
  quantity: number;
  unit: string;
  waste_percent: number;
  loss_percent: number;
}

export interface Recipe {
  id: string;
  product_id: string;
  product_name: string;
  name: string;
  yield_percent: number;
  output_quantity: number;
  output_unit: string;
  is_active: boolean;
  version: number;
  notes: string | null;
  items?: RecipeItem[];
}

export interface ComponentCost {
  component_product_id: string;
  name: string | null;
  quantity: number;
  unit: string;
  unit_cost_cents: Cents | null;
  line_cost_cents: Cents | null;
  unresolved_reason: string | null;
}

export interface RecipeCost {
  recipe_id: string | null;
  product_id: string;
  product_name: string | null;
  yield_percent: number;
  output_quantity: number;
  output_unit: string;
  /** Malzeme maliyetlerinin toplamı. */
  materials_cost_cents: Cents | null;
  /** `output_quantity` adet üretimin toplam maliyeti (birim değil). */
  standard_cost_cents: Cents | null;
  /** Üretilen bir birimin maliyeti = `standard_cost_cents / output_quantity`. */
  unit_cost_cents: Cents | null;
  /** Randıman kaybının tutarı; P&L'de görünmeli. */
  waste_cost_cents: Cents | null;
  components: ComponentCost[];
  /** Çözülemeyen bileşen adları. Boş değilse maliyet alanları `null` gelir. */
  unresolved: string[];
}

type String_or_null = string | null;

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_term_days: number;
  lead_time_days: number;
  is_active: boolean;
  notes: string | null;
}

export interface SupplierPriceRow {
  supplier_id: string;
  supplier_name: string;
  unit_cost_cents: Cents;
  is_preferred: boolean;
  lead_time_days: number;
}

export interface PriceGap {
  product_id: string;
  product_name: String_or_null;
  rows: SupplierPriceRow[];
  lowest_cents: Cents | null;
  highest_cents: Cents | null;
  gap_cents: Cents | null;
  gap_percent: number | null;
  annual_saving_cents: Cents | null;
}

export interface ShelfLifePolicy {
  id: string;
  product_id: string;
  product_name: string;
  shelf_life_days: number;
  warning_days: number;
  storage_instruction: string | null;
  is_active: boolean;
}

export interface BatchFreshness {
  batch_id: string;
  product_id: string;
  product_name: string;
  batch_code: string | null;
  remaining_quantity: number;
  received_at: string;
  expiry_date: string | null;
  days_left: number | null;
  state: 'TAZE' | 'YAKLASIYOR' | 'SURESI_GECTI';
}

export interface ExpiryReport {
  expired: BatchFreshness[];
  expiring: BatchFreshness[];
}

export interface WasteRecord {
  id: string;
  product_id: string;
  product_name: string;
  reason: string;
  quantity: number;
  unit_cost_cents: Cents | null;
  total_cost_cents: Cents | null;
  occurred_at: string;
  recorded_by: string;
  notes: string | null;
}

export interface StockCountLine {
  product_id: string;
  product_name: string;
  counted_quantity: number;
  /** Kapanışta hesaplanır. Satır açıldığında `null` olabilir. */
  expected_quantity: number | null;
  variance_quantity: number | null;
  variance_cost_cents: Cents | null;
  counted_by: string | null;
  counted_at: string | null;
}

export interface StockCount {
  id: string;
  status: 'ACIK' | 'KAPALI' | 'UYGULANDI';
  location: string | null;
  started_by: string;
  started_at: string;
  closed_by: string | null;
  closed_at: string | null;
  notes: string | null;
  lines?: StockCountLine[];
}

/** Fire gerekçeleri. Backend ile birebir aynı küme; sapma reddedilir. */
export const WASTE_REASONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'BOZULMA', label: 'Bozulma' },
  { id: 'SURE', label: 'Tarih geçti' },
  { id: 'KIRILMA', label: 'Kırılma / hasar' },
  { id: 'MUTFAK_HATASI', label: 'Mutfak hatası' },
  { id: 'SERVIS_IADESI', label: 'Servis iadesi' },
  { id: 'KAYIP', label: 'Kayıp / çalınma' },
  { id: 'DIGER', label: 'Diğer' },
];

/** Backend'in kabul ettiği gerekçe kodları. Gönderilecek `id` alanıdır. */
export const WASTE_REASON_CODES: readonly string[] = WASTE_REASONS.map((r) => r.id);

export function wasteReasonLabel(code: string): string {
  return WASTE_REASONS.find((r) => r.id === code)?.label ?? code;
}

export function priceSourceLabel(source: EffectivePrice['source']): string {
  switch (source) {
    case 'FROZEN':
      return 'Fiyat dondurma';
    case 'DYNAMIC_RULE':
      return 'Dinamik kural';
    case 'PRICE_LIST':
      return 'Fiyat listesi';
    case 'PRODUCT_PRICE':
      return 'Ürün fiyatı';
    default:
      return source;
  }
}

export function freshnessLabel(state: BatchFreshness['state']): string {
  switch (state) {
    case 'TAZE':
      return 'Taze';
    case 'YAKLASIYOR':
      return 'Yaklaşıyor';
    case 'SURESI_GECTI':
      return 'Süresi geçti';
    default:
      return state;
  }
}