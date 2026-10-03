// Faz 12 · Envanter 360 mock DTO'ları.
//
// Tipler depo dosyasından ayrı tutulur: iki komut dosyası (fiyat/reçete ve
// tedarikçi/raf ömrü/fire) bu tipleri kullanır, depo yalnız durum ve kapı
// tutar. Böylece depo dosyası 500 satır sınırının altında kalır ve tip
// değişikliği iki yerde değil tek yerde yapılır.
//
// Finansal alanlar `number | null`: `null` bilinmeyen tutarı gösterir, `0`
// göstermez (AGENTS.md §3.4).

export interface MockPriceListItem {
  id: string;
  product_id: string;
  product_name: string;
  price_cents: number;
}

export interface MockPriceList {
  id: string;
  name: string;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  items: MockPriceListItem[];
}

export interface MockPricingRule {
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

export interface MockServiceWindow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  product_count: number;
}

export interface MockSupplier {
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

export interface MockSupplierPrice {
  supplier_id: string;
  product_id: string;
  unit_cost_cents: number;
  is_preferred: boolean;
}

export interface MockRecipeItem {
  id: string;
  component_product_id: string;
  component_name: string | null;
  quantity: number;
  unit: string;
}

export interface MockRecipe {
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
  items: MockRecipeItem[];
}

export interface MockWasteRecord {
  id: string;
  product_id: string;
  product_name: string;
  reason: string;
  quantity: number;
  unit_cost_cents: number | null;
  total_cost_cents: number | null;
  occurred_at: string;
  recorded_by: string;
  notes: string | null;
}

export interface MockStockCountLine {
  product_id: string;
  product_name: string;
  counted_quantity: number;
  expected_quantity: number | null;
  variance_quantity: number | null;
  variance_cost_cents: number | null;
  counted_by: string | null;
  counted_at: string | null;
}

export interface MockStockCount {
  id: string;
  tenant_id: string;
  status: 'ACIK' | 'KAPALI' | 'UYGULANDI';
  location: string | null;
  started_by: string;
  started_at: string;
  closed_by: string | null;
  closed_at: string | null;
  notes: string | null;
  lines: MockStockCountLine[];
}

export interface MockBatch {
  id: string;
  product_id: string;
  product_name: string;
  batch_code: string | null;
  remaining_quantity: number;
  /** Partinin birim alış maliyeti (kuruş). Reçete maliyeti buradan okunur. */
  unit_cost_cents: number;
  received_at: string;
  expiry_date: string | null;
}

export interface MockPriceFreeze {
  product_id: string;
  frozen_price_cents: number;
  valid_from: string;
  valid_to: string;
}

export interface MockState {
  priceLists: MockPriceList[];
  pricingRules: MockPricingRule[];
  serviceWindows: MockServiceWindow[];
  suppliers: MockSupplier[];
  supplierPrices: MockSupplierPrice[];
  recipes: MockRecipe[];
  batches: MockBatch[];
  waste: MockWasteRecord[];
  stockCounts: MockStockCount[];
  priceFreezes: MockPriceFreeze[];
  productPrices: Record<string, number>;
  productNames: Record<string, string>;
}
