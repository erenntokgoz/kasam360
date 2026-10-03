// Depo bu tipleri yeniden dışa açar: komut dosyaları ve testler tek modülden
// okur, tip tanımının taşınmadığı yer olmaz.
export type {
  MockBatch,
  MockPriceFreeze,
  MockPriceList,
  MockPriceListItem,
  MockPricingRule,
  MockRecipe,
  MockRecipeItem,
  MockServiceWindow,
  MockState,
  MockStockCount,
  MockStockCountLine,
  MockSupplier,
  MockSupplierPrice,
  MockWasteRecord,
} from './inventory360MockTypes';

import type { MockState } from './inventory360MockTypes';

// Faz 12 · Envanter 360 mock deposu, kapıları ve dispatcher.
//
// Bu dosya üç parçadan oluşur:
//   1. Tipler — mock DTO'ları.
//   2. Depo  — localStorage'da tutulan durum ve komut yardımcıları.
//   3. Dispatcher — komut adını iki uygulama dosyasına yönlendirir.
//
// Komut uygulamaları `inventory360PriceMock` (fiyat, reçete) ve
// `inventory360OpsMock` (tedarikçi, raf ömrü, fire) dosyalarındadır. Kapı
// fonksiyonları burada kalır; iki uygulama da **aynı** yetki/bayrak/kiracı
// kapılarını çağırır, bu yüzden mock'un tek bir noktada gevşemesi mümkün
// değildir.
//
// Backend kapıları birebir kopyalanır:
//   * rol (RBAC) — yetkisiz rol `UNAUTHORIZED` alır,
//   * tenant — boş kiracı reddedilir, `DEFAULT_TENANT`e düşülmez,
//   * feature bayrağı — kapalıysa `NOT_FOUND` (403 değil).
//
// Finansal değerler `number | null` olarak tutulur. `null` "bilinmiyor" demektir
// ve `0`a çevrilmez (AGENTS.md §3.4).

import { PRICE_COMMANDS } from './inventory360PriceMock';
import { SUPPLIER_SHELF_WASTE_COMMANDS } from './inventory360OpsMock';

/** Yalnız okuyan roller: kasa fiyatı çözer, mutfak menü görür. */
export const INVENTORY360_READ_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];

/**
 * Fabrika ayarı.
 *
 * Neden sabit veri: sözleşme testleri "dondurulmuş fiyat ürün fiyatını yener",
 * "reçete bileşenleri çözülür", "raf ömrü yaklaşan partiyi listeler" gibi
 * kuralları belirli bir başlangıç durumu üzerinden kanıtlar. Rastgele veri
 * kullanan mock bu testleri kararsızlaştırır.
 */
function factoryState(): MockState {
  return {
    priceLists: [],
    pricingRules: [],
    serviceWindows: [
      {
        id: 'msw_ogle',
        name: 'OGLE',
        start_time: '11:00',
        end_time: '15:00',
        is_active: true,
        product_count: 1,
      },
      {
        id: 'msw_aksam',
        name: 'AKSAM',
        start_time: '18:00',
        end_time: '23:00',
        is_active: true,
        product_count: 1,
      },
    ],
    suppliers: [
      {
        id: 'sup_1',
        name: 'Anadolu Toptan',
        contact_person: 'Mehmet',
        phone: null,
        email: null,
        payment_term_days: 30,
        lead_time_days: 2,
        is_active: true,
        notes: null,
      },
      {
        id: 'sup_2',
        name: 'Marmara Gıda',
        contact_person: null,
        phone: null,
        email: null,
        payment_term_days: 15,
        lead_time_days: 4,
        is_active: true,
        notes: null,
      },
    ],
    supplierPrices: [
      { supplier_id: 'sup_1', product_id: 'prd_kahve', unit_cost_cents: 7200, is_preferred: true },
      { supplier_id: 'sup_2', product_id: 'prd_kahve', unit_cost_cents: 6800, is_preferred: false },
    ],
    recipes: [
      {
        id: 'rec_1',
        product_id: 'prd_latte',
        product_name: 'Latte',
        name: 'Latte standart',
        yield_percent: 100,
        output_quantity: 1,
        output_unit: 'adet',
        is_active: true,
        version: 1,
        notes: null,
        items: [
          {
            id: 'rit_1',
            component_product_id: 'prd_kahve',
            component_name: 'Kahve',
            quantity: 18,
            unit: 'g',
          },
          {
            id: 'rit_2',
            component_product_id: 'prd_sut',
            component_name: 'Süt',
            quantity: 150,
            unit: 'ml',
          },
        ],
      },
    ],
    batches: [
      {
        id: 'bat_1',
        product_id: 'prd_kahve',
        product_name: 'Kahve',
        batch_code: 'K-2026-01',
        remaining_quantity: 4,
        received_at: '2026-10-01T08:00:00Z',
        expiry_date: null,
        unit_cost_cents: 7200,
      },
      {
        id: 'bat_2',
        product_id: 'prd_sut',
        product_name: 'Süt',
        batch_code: 'S-2026-02',
        remaining_quantity: 6,
        received_at: '2026-10-02T08:00:00Z',
        // Üç gün sonra doluyor: uyarı penceresinde görünür.
        expiry_date: '2026-10-06',
        unit_cost_cents: 3200,
      },
    ],
    waste: [],
    stockCounts: [],
    priceFreezes: [
      { product_id: 'prd_kahve', frozen_price_cents: 4200, valid_from: '1970-01-01', valid_to: '2099-12-31' },
    ],
    productPrices: { prd_kahve: 4500, prd_sut: 2500, prd_latte: 8500 },
    productNames: { prd_kahve: 'Kahve', prd_sut: 'Süt', prd_latte: 'Latte' },
  };
}

const LS_KEY = 'inventory360_state';

const ls = {
  load(): MockState {
    try {
      if (typeof localStorage === 'undefined') return factoryState();
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return factoryState();
      return { ...factoryState(), ...(JSON.parse(raw) as Partial<MockState>) };
    } catch {
      // Bozuk JSON veya erişilemeyen depo: sessizce fabrika ayarına dön.
      return factoryState();
    }
  },
  save(state: MockState): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      // Kota dolu veya gizli mod — komut yine de çalışır, yalnız kalıcı olmaz.
    }
  },
};

/**
 * Canlı depo.
 *
 * Komut dosyaları `state.<alan>` mutasyonu yapar ve `persist()` çağırır; bu
 * yüzden bağlama bir nesne olarak `export let` ile açılır, ES modül bağlantısı
 * canlı olduğu için importer her zaman güncel durumu görür.
 */
export let state: MockState = ls.load();

/** Komut sonrası durumu kalıcılaştırır. Her yazma komutundan sonra çağrılır. */
export function persist(): void {
  ls.save(state);
}

/** Testler için tüm Faz 12 depolarını fabrika ayarlarına döndürür. */
export function resetMockInventory360(): void {
  state = factoryState();
  persist();
}

/** Argümanı birden çok anahtar adıyla okur (camelCase ve snake_case). */
export function arg(args: Record<string, unknown>, ...keys: string[]): unknown {
  for (const anahtar of keys) {
    const deger = args[anahtar];
    if (deger !== undefined) return deger;
  }
  return undefined;
}

/** Komutun iç içe `args` gövdesini döndürür; gövde yoksa boş nesne. */
export function nested(args: Record<string, unknown>, anahtar: string): Record<string, unknown> {
  const deger = arg(args, anahtar);
  return (deger && typeof deger === 'object' ? deger : {}) as Record<string, unknown>;
}

export function readRole(args: Record<string, unknown>): string {
  return String(arg(args, 'actor_role', 'actorRole', 'caller_role', 'callerRole') ?? '')
    .trim()
    .toUpperCase();
}

export function readTenant(args: Record<string, unknown>): string {
  return String(arg(args, 'tenant_id', 'tenantId') ?? '').trim();
}

/** Backend `rbac::require_any` ile aynı kapı. */
export function requireInventoryRole(
  args: Record<string, unknown>,
  izin: readonly string[],
): string {
  const role = readRole(args);
  if (!izin.includes(role)) {
    throw new Error(`UNAUTHORIZED: Bu işlem için yetki yok (izin: ${izin.join(', ')}).`);
  }
  if (!readTenant(args)) {
    throw new Error('UNAUTHORIZED: tenant_id zorunludur');
  }
  return role;
}

/**
 * Backend `require_dynamic_pricing` / `require_recipe_bom` /
 * `require_loss_radar` ile aynı kapı. 403 değil **404** döner: bayrak kapalıyken
 * özellik yoktur, ayrıca "senin yetkin yok" bilgisi sızmamalıdır.
 */
export function requireInventoryFlag(
  args: Record<string, unknown>,
  bayrak: string,
  ozellik: string,
): string {
  const moduller = (arg(args, 'active_modules', 'activeModules') as string[] | undefined) ?? [];
  if (!Array.isArray(moduller) || !moduller.includes(bayrak)) {
    throw new Error(`NOT_FOUND: ${ozellik} bu işletmede etkin değil`);
  }
  return requireInventoryRole(args, ['OWNER', 'MANAGER']);
}

/** Fire gerekçeleri. Backend `GECERLI_GEREKCELER` kümesiyle birebir aynı. */
export const WASTE_CODES: readonly string[] = [
  'BOZULMA',
  'SURE',
  'KIRILMA',
  'MUTFAK_HATASI',
  'SERVIS_IADESI',
  'KAYIP',
  'DIGER',
];

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Son kullanma tarihine kalan gün; tarih yoksa `null` (bilinmiyor). */
export function daysUntil(tarih: string): number | null {
  const hedef = new Date(`${tarih}T23:59:59Z`);
  if (Number.isNaN(hedef.getTime())) return null;
  return Math.ceil((hedef.getTime() - Date.now()) / 86_400_000);
}

/**
 * Ürün adı.
 *
 * Silinmiş üründe "Ürün silinmiş" yazılır, `null` değil: rapor satırı kaybolmaz,
 * ama faturalandırılabilir bir tutar da uydurulmaz.
 */
export function nestedProductName(productId: string): string {
  return state.productNames[productId] ?? 'Ürün silinmiş';
}

/**
 * Kasa fiyat çözümlemesi: dondurma → dinamik kural → ürün fiyatı.
 *
 * Backend aynı önceliği kullanır ve araya fiyat listesini koyar. Mock liste
 * fiyatını uygulamaz; liste katmanı kendi komutuyla doğrulanır, kasa
 * çözümlemesi ise her işletmede aynı kuralı izler.
 */
export function resolvePrice(productId: string): Record<string, unknown> {
  const base = state.productPrices[productId];
  const donmus = state.priceFreezes.find((kayit) => kayit.product_id === productId);
  const kural = state.pricingRules.find((kayit) => kayit.is_active);

  let finalPrice: number | null = base ?? null;
  let source = 'PRODUCT_PRICE';
  let discount = 0;
  let ruleId: string | null = null;
  let ruleName: string | null = null;

  if (donmus) {
    finalPrice = donmus.frozen_price_cents;
    source = 'FROZEN';
  } else if (kural && base !== undefined) {
    finalPrice = Math.round(base * (1 - kural.discount_percent / 100));
    source = 'DYNAMIC_RULE';
    discount = base - finalPrice;
    ruleId = kural.id;
    ruleName = kural.name;
  }

  return {
    product_id: productId,
    base_price_cents: base ?? null,
    final_price_cents: finalPrice,
    source,
    discount_cents: discount,
    rule_id: ruleId,
    rule_name: ruleName,
    is_86d: false,
    stockout_reason: null,
    service_window: null,
  };
}

const COMMANDS: Record<string, (args: Record<string, unknown>) => unknown> = {
  ...PRICE_COMMANDS,
  ...SUPPLIER_SHELF_WASTE_COMMANDS,
};

const COMMAND_LIST = Object.keys(COMMANDS);

/** Komut Faz 12'ye ait mi? */
export function isMockInventory360Command(cmd: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMMANDS, cmd);
}

export function mockInventory360CommandNames(): readonly string[] {
  return COMMAND_LIST;
}

export function mockInventory360Result(cmd: string, args: Record<string, unknown>): unknown {
  const uygula = COMMANDS[cmd];
  if (!uygula) {
    throw new Error(`NOT_FOUND: bilinmeyen Faz 12 komutu (${cmd})`);
  }
  return uygula(args);
}

/** Testler için depoları okur. */
export function readMockInventory360State(): MockState {
  return state;
}