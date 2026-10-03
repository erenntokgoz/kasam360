// Faz 12 · Fiyatlandırma ve reçete mock komutları.
//
// Bu dosya `inventory360Mock` deposunu kullanır ve yalnız **fiyat** ve
// **reçete** komutlarını uygular. Depo, türler ve kapılar orada yaşar; iki
// dosya aynı kapı fonksiyonlarını çağırır, bu yüzden mock'un gevşek kaldığı
// tek bir nokta olamaz.
//
// Backend karşılığı: `inventory360_commands::pricing_commands` ve
// `inventory360_commands::recipe_commands`.

import {
  arg,
  nested,
  nestedProductName,
  persist,
  requireInventoryFlag,
  requireInventoryRole,
  resolvePrice,
  state,
  INVENTORY360_READ_ROLES,
  type MockPriceList,
  type MockPricingRule,
  type MockRecipe,
  type MockServiceWindow,
} from './inventory360Mock';

const INVENTORY360_MANAGE_ROLES = ['OWNER', 'MANAGER'];
const INVENTORY360_OWNER_ROLES = ['OWNER'];

export const PRICE_COMMANDS: Record<string, (args: Record<string, unknown>) => unknown> = {
  // ── Fiyatlandırma ────────────────────────────────────────────────────────
  get_effective_price(args) {
    requireInventoryRole(args, INVENTORY360_READ_ROLES);
    const govde = nested(args, 'args');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '').trim();
    if (!urunId) throw new Error('VALIDATION: ürün kimliği zorunludur');
    return resolvePrice(urunId);
  },
  list_price_lists(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    return state.priceLists;
  },
  create_price_list_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const ad = String(arg(govde, 'name') ?? '').trim();
    if (!ad) throw new Error('VALIDATION: fiyat listesi adı boş olamaz');
    const liste: MockPriceList = {
      id: `pls_${state.priceLists.length + 1}`,
      name: ad,
      kind: String(arg(govde, 'kind') ?? 'PERAKENDE'),
      valid_from: (arg(govde, 'valid_from', 'validFrom') as string | undefined) ?? null,
      valid_to: (arg(govde, 'valid_to', 'validTo') as string | undefined) ?? null,
      is_active: true,
      items: [],
    };
    state.priceLists.push(liste);
    persist();
    return liste;
  },
  delete_price_list_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const id = String(arg(args, 'id') ?? '').trim();
    const onceki = state.priceLists.length;
    state.priceLists = state.priceLists.filter((liste) => liste.id !== id);
    if (state.priceLists.length === onceki) throw new Error('NOT_FOUND: fiyat listesi bulunamadı');
    persist();
    return { success: true };
  },
  create_price_freeze_command(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '').trim();
    const fiyat = Number(arg(govde, 'frozen_price_cents', 'frozenPriceCents') ?? 0);
    if (!urunId) throw new Error('NOT_FOUND: ürün bulunamadı');
    if (fiyat < 0) throw new Error('VALIDATION: dondurulacak fiyat negatif olamaz');
    const mevcut = state.productPrices[urunId];
    if (mevcut !== undefined && fiyat > mevcut) {
      throw new Error('VALIDATION: donmuş fiyat ürün fiyatından yüksek olamaz');
    }
    state.priceFreezes.push({
      product_id: urunId,
      frozen_price_cents: fiyat,
      valid_from: String(arg(govde, 'valid_from', 'validFrom') ?? '1970-01-01'),
      valid_to: String(arg(govde, 'valid_to', 'validTo') ?? '2099-12-31'),
    });
    persist();
    return `frz_${state.priceFreezes.length}`;
  },
  bulk_update_product_prices(args) {
    requireInventoryRole(args, INVENTORY360_OWNER_ROLES);
    const govde = nested(args, 'args');
    const yuzde = arg(govde, 'percent');
    const yuvarla = arg(govde, 'round_to_tens', 'roundToTens') === true;
    const kategori = (arg(govde, 'category_id', 'categoryId') as string | undefined) ?? null;
    const urunler = (arg(govde, 'product_ids', 'productIds') as string[] | undefined) ?? null;
    if (kategori && urunler) {
      throw new Error('VALIDATION: kategori ve ürün listesi birlikte verilemez');
    }
    if (yuzde === undefined || yuzde === null) {
      throw new Error('VALIDATION: yüzde veya mutlak tutar zorunludur');
    }
    const oran = Number(yuzde);
    const hedefler = urunler ?? Object.keys(state.productPrices);
    const changed: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const urunId of hedefler) {
      const eski = state.productPrices[urunId];
      if (eski === undefined) continue;
      let yeni = Math.round(eski * (1 + oran / 100));
      if (yuvarla) yeni = Math.round(yeni / 10) * 10;
      const satir = {
        product_id: urunId,
        product_name: nestedProductName(urunId),
        old_price_cents: eski,
        new_price_cents: yeni,
        skipped: null,
      };
      if (yeni < 0) {
        // Negatif sonuç reddedilir, sıfıra kırpılmaz: ürün bedava verilmez.
        throw new Error(`VALIDATION: ${satir.product_name} için hesaplanan fiyat negatif`);
      }
      if (state.priceFreezes.some((kayit) => kayit.product_id === urunId)) {
        skipped.push({ ...satir, skipped: 'fiyat dondurma aktif' });
        continue;
      }
      state.productPrices[urunId] = yeni;
      changed.push(satir);
    }
    persist();
    return { changed, skipped, category_id: kategori };
  },
  get_pricing_rules(args) {
    requireInventoryFlag(args, 'feat_dynamic_pricing', 'dinamik tarife');
    return state.pricingRules;
  },
  upsert_pricing_rule_command(args) {
    requireInventoryFlag(args, 'feat_dynamic_pricing', 'dinamik tarife');
    const govde = nested(args, 'args');
    const indirim = Number(arg(govde, 'discount_percent', 'discountPercent') ?? 0);
    if (indirim < 1 || indirim > 90) {
      throw new Error('VALIDATION: indirim yüzdesi 1-90 arasında olmalı');
    }
    const kural: MockPricingRule = {
      id: `dpr_${state.pricingRules.length + 1}`,
      name: String(arg(govde, 'name') ?? 'Kural'),
      kind: String(arg(govde, 'kind') ?? 'HAPPY_HOUR'),
      discount_percent: indirim,
      start_time: String(arg(govde, 'start_time', 'startTime') ?? '17:00'),
      end_time: String(arg(govde, 'end_time', 'endTime') ?? '19:00'),
      days_of_week: (arg(govde, 'days_of_week', 'daysOfWeek') as string | undefined) ?? null,
      valid_from: (arg(govde, 'valid_from', 'validFrom') as string | undefined) ?? null,
      valid_to: (arg(govde, 'valid_to', 'validTo') as string | undefined) ?? null,
      is_active: true,
      priority: Number(arg(govde, 'priority') ?? 100),
    };
    state.pricingRules.push(kural);
    persist();
    return kural;
  },
  get_service_windows(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    return state.serviceWindows;
  },
  upsert_service_window_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const govde = nested(args, 'args');
    const ad = String(arg(govde, 'name') ?? '').trim().toUpperCase();
    if (!ad) throw new Error('VALIDATION: menü penceresi adı boş olamaz');
    const pencere: MockServiceWindow = {
      id: `msw_${state.serviceWindows.length + 1}`,
      name: ad,
      start_time: String(arg(govde, 'start_time', 'startTime') ?? '11:00'),
      end_time: String(arg(govde, 'end_time', 'endTime') ?? '15:00'),
      is_active: true,
      product_count: 0,
    };
    state.serviceWindows.push(pencere);
    persist();
    return pencere;
  },
  set_menu_window_product(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const govde = nested(args, 'args');
    const pencere = state.serviceWindows.find((kayit) => kayit.id === String(arg(govde, 'window_id', 'windowId')));
    if (!pencere) throw new Error('NOT_FOUND: menü penceresi bulunamadı');
    pencere.product_count += 1;
    persist();
    return { success: true };
  },
  set_product_86d_command(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    const govde = nested(args, 'args');
    return { is86d: arg(govde, 'is_86d', 'is86d') === true };
  },
  set_product_active_window(args) {
    requireInventoryRole(args, INVENTORY360_MANAGE_ROLES);
    return { success: true };
  },

  // ── Reçete ───────────────────────────────────────────────────────────────
  list_inventory_recipes(args) {
    requireInventoryFlag(args, 'feat_recipe_bom', 'reçete ve maliyet dökümü');
    return state.recipes;
  },
  create_recipe_command(args) {
    requireInventoryFlag(args, 'feat_recipe_bom', 'reçete ve maliyet dökümü');
    const govde = nested(args, 'args');
    const randiman = Number(arg(govde, 'yield_percent', 'yieldPercent') ?? 0);
    if (!(randiman > 0 && randiman <= 100)) {
      throw new Error('VALIDATION: randıman 0-100 arasında olmalı');
    }
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '');
    const recete: MockRecipe = {
      id: `rec_${state.recipes.length + 1}`,
      product_id: urunId,
      product_name: nestedProductName(urunId),
      name: String(arg(govde, 'name') ?? 'Reçete'),
      yield_percent: randiman,
      output_quantity: Number(arg(govde, 'output_quantity', 'outputQuantity') ?? 1),
      output_unit: String(arg(govde, 'output_unit', 'outputUnit') ?? 'adet'),
      is_active: true,
      version: 1,
      notes: (arg(govde, 'notes') as string | undefined) ?? null,
      items: [],
    };
    state.recipes.push(recete);
    persist();
    return recete;
  },
  deactivate_recipe_command(args) {
    requireInventoryFlag(args, 'feat_recipe_bom', 'reçete ve maliyet dökümü');
    const govde = nested(args, 'args');
    const recete = state.recipes.find((kayit) => kayit.id === String(arg(govde, 'recipe_id', 'recipeId')));
    if (!recete) throw new Error('NOT_FOUND: reçete bulunamadı');
    recete.is_active = false;
    persist();
    return { success: true };
  },
  get_recipe_cost(args) {
    requireInventoryFlag(args, 'feat_recipe_bom', 'reçete ve maliyet dökümü');
    const govde = nested(args, 'args');
    const urunId = String(arg(govde, 'product_id', 'productId') ?? '');
    const recete = state.recipes.find((kayit) => kayit.product_id === urunId && kayit.is_active);
    // Reçete yoksa "maliyet bilinmiyor" döner; sıfır maliyet değil. Ekran `null`
    // gördüğünde "hesaplanamadı" der, `0` gördüğünde "bedava" der.
    if (!recete) {
      return {
        recipe_id: null,
        product_id: urunId,
        product_name: null,
        yield_percent: 100,
        output_quantity: 1,
        output_unit: 'adet',
        materials_cost_cents: null,
        standard_cost_cents: null,
        unit_cost_cents: null,
        waste_cost_cents: null,
        components: [],
        unresolved: [],
      };
    }

    const components = recete.items.map((bilesen) => {
      // Maliyet kaynağı: tedarikçi fiyatı → stok partisi → tanımsız.
      const fiyatlar = state.supplierPrices.filter((kayit) => kayit.product_id === bilesen.component_product_id);
      const parti = state.batches.find(
        (kayit) => kayit.product_id === bilesen.component_product_id && kayit.remaining_quantity > 0,
      );
      // Partisi olan malzemenin maliyeti **partiden** okunur. Partiyi "maliyeti
      // var" sayıp `0` yazmak maliyeti bedavaya düşürür.
      const birim = fiyatlar.length > 0
        ? Math.min(...fiyatlar.map((kayit) => kayit.unit_cost_cents))
        : parti
          ? parti.unit_cost_cents
          : null;
      return {
        component_product_id: bilesen.component_product_id,
        name: bilesen.component_name,
        quantity: bilesen.quantity,
        unit: bilesen.unit,
        unit_cost_cents: birim,
        line_cost_cents: birim === null ? null : Math.round(birim * bilesen.quantity),
        unresolved_reason: birim === null ? 'malzeme maliyeti bilinmiyor: reçetesiz ve fiyatsız' : null,
      };
    });

    const cozulemeyenler = components.filter((bilesen) => bilesen.unit_cost_cents === null);
    const materials = cozulemeyenler.length > 0
      ? null
      : components.reduce((toplam, b) => toplam + (b.line_cost_cents ?? 0), 0);
    // Randıman yüzdedir: %80 randıman maliyetin 100/80 katını gerektirir.
    const standard = materials === null
      ? null
      : Math.round((materials * 100) / Math.max(recete.yield_percent, 1e-9));
    const unit = standard === null || recete.output_quantity <= 0
      ? null
      : Math.round(standard / recete.output_quantity);

    return {
      recipe_id: recete.id,
      product_id: urunId,
      product_name: recete.product_name,
      yield_percent: recete.yield_percent,
      output_quantity: recete.output_quantity,
      output_unit: recete.output_unit,
      materials_cost_cents: materials,
      standard_cost_cents: standard,
      unit_cost_cents: unit,
      waste_cost_cents: standard === null || materials === null ? null : standard - materials,
      components,
      unresolved: cozulemeyenler.map((bilesen) => bilesen.name),
    };
  },
};

export default PRICE_COMMANDS;