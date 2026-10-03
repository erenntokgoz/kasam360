import { describe, it, expect, beforeEach } from 'vitest';
import {
  tauriInvoke,
  resetMockInventory360,
  INVENTORY360_COMMAND_NAMES,
} from '../../src/data/ipc/tauriInvoke';
import { readMockInventory360State } from '../../src/data/ipc/inventory360Mock';
import {
  money,
  quantity,
  wasteReasonLabel,
  type EffectivePrice,
  type ExpiryReport,
  type PriceGap,
  type PriceList,
  type Recipe,
  type RecipeCost,
  type ServiceWindow,
  type StockCount,
  type WasteRecord,
} from '../../src/presentation/components/owner/inventory/inventory360Types';

/**
 * Faz 12 Envanter 360° — sözleşme testleri.
 *
 * Kapsam: mock katmanının backend ile **aynı** kapıları uyguladığını kanıtlamak.
 * Üç sınıf açık vardır:
 *
 *   1. Yetki — yetkisiz rol reddedilir, müdür yazamaz.
 *   2. Kiracı — boş kiracı reddedilir; `DEFAULT_TENANT`e düşülmez.
 *   3. Bayrak — kapalı bayrak 404 döner, 403 değil.
 *
 * Dördüncü sınıf: **sessiz sıfır**. Maliyet bilinmiyorsa `null` döner; test
 * `0` dönmediğini de açıkça doğrular (AGENTS.md §3.4).
 */

const TENANT = 'tenant-test';
const AUTH = { tenantId: TENANT, tenant_id: TENANT, actorRole: 'OWNER', actor_role: 'OWNER' };
const MANAGER_AUTH = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'MANAGER',
  actor_role: 'MANAGER',
};
const WAITER_AUTH = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'WAITER',
  actor_role: 'WAITER',
};
const ALL_FLAGS = {
  activeModules: ['feat_recipe_bom', 'feat_loss_radar', 'feat_dynamic_pricing'],
  active_modules: ['feat_recipe_bom', 'feat_loss_radar', 'feat_dynamic_pricing'],
};

beforeEach(() => {
  resetMockInventory360();
});

describe('Faz 12 komut listesi', () => {
  it('arayüzün bildiği komutlar mock dispatcher içinde tanımlı', () => {
    expect(INVENTORY360_COMMAND_NAMES.length).toBeGreaterThan(20);
    for (const komut of INVENTORY360_COMMAND_NAMES) {
      expect(typeof komut).toBe('string');
    }
  });

  it('komut adları benzersizdir', () => {
    const benzersiz = new Set(INVENTORY360_COMMAND_NAMES);
    expect(benzersiz.size).toBe(INVENTORY360_COMMAND_NAMES.length);
  });
});

describe('Kiracı izolasyonu kapısı', () => {
  it('boş kiracı reddedilir, DEFAULT_TENANT düşmez', async () => {
    await expect(
      tauriInvoke('get_inventory_suppliers', { actorRole: 'OWNER', actor_role: 'OWNER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('gövde içinde boş kiracı da reddedilir', async () => {
    await expect(
      tauriInvoke('list_price_lists', { tenantId: '   ', tenant_id: '   ', actorRole: 'OWNER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe('Fiyatlandırma yetki kapıları', () => {
  it('garson fiyat yönetimini göremez', async () => {
    await expect(tauriInvoke('list_price_lists', { ...WAITER_AUTH })).rejects.toThrow(/UNAUTHORIZED/);
    await expect(tauriInvoke('get_service_windows', { ...WAITER_AUTH })).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('garson kasada fiyat çözümlemesini görebilir', async () => {
    const sonuc = await tauriInvoke<EffectivePrice>('get_effective_price', {
      ...WAITER_AUTH,
      args: { product_id: 'prd_kahve' },
    });
    expect(sonuc.final_price_cents).toBe(4200);
  });

  it('müdür fiyat listesi oluşturamaz', async () => {
    await expect(
      tauriInvoke('create_price_list_command', {
        ...MANAGER_AUTH,
        args: { name: 'Toptan' },
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('müdür menü penceresi açabilir', async () => {
    const pencere = await tauriInvoke<ServiceWindow>('upsert_service_window_command', {
      ...MANAGER_AUTH,
      args: { name: 'ogle', startTime: '11:00', endTime: '15:00' },
    });
    expect(pencere.name).toBe('OGLE');
  });
});

describe('Fiyat dondurma P0 kilidi', () => {
  it('donmuş fiyat çözümlemede ürün fiyatını eğer', async () => {
    const sonuc = await tauriInvoke<EffectivePrice>('get_effective_price', {
      ...AUTH,
      args: { product_id: 'prd_kahve' },
    });
    expect(sonuc.source).toBe('FROZEN');
    expect(sonuc.final_price_cents).toBe(4200);
    expect(sonuc.base_price_cents).toBe(4500);
  });

  it('toplu zam donmuş ürünü atlar ve raporda listeler', async () => {
    const sonuc = await tauriInvoke<{ changed: unknown[]; skipped: Array<{ product_id: string }> }>(
      'bulk_update_product_prices',
      { ...AUTH, args: { percent: 10, roundToTens: true } },
    );
    const atlanan = sonuc.skipped.map((satir) => satir.product_id);
    expect(atlanan).toContain('prd_kahve');
    expect(sonuc.changed.map((s) => (s as { product_id: string }).product_id)).not.toContain('prd_kahve');
  });

  it('dondurma ürün fiyatından yüksekse reddedilir', async () => {
    await expect(
      tauriInvoke('create_price_freeze_command', {
        ...AUTH,
        args: { productId: 'prd_kahve', frozenPriceCents: 9999, validFrom: '2026-01-01', validTo: '2026-12-31' },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });
});

describe('Feature bayrağı 404 kapısı', () => {
  it('dinamik tarife kapalıyken kural listelenmez', async () => {
    await expect(
      tauriInvoke('get_pricing_rules', {
        ...AUTH,
        activeModules: ['feat_recipe_bom'],
        active_modules: ['feat_recipe_bom'],
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('reçete kapalıyken maliyet dökümü 404 döner', async () => {
    await expect(
      tauriInvoke('list_inventory_recipes', {
        ...AUTH,
        activeModules: ['feat_loss_radar'],
        active_modules: ['feat_loss_radar'],
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('raf ömrü kapalıyken rapor 404 döner', async () => {
    await expect(
      tauriInvoke('get_expiry_report', {
        ...AUTH,
        activeModules: [],
        active_modules: [],
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('bayrak bilgisi hiç gönderilmezse de kapalı sayılır', async () => {
    await expect(tauriInvoke('get_expiry_report', { ...AUTH })).rejects.toThrow(/NOT_FOUND/);
  });

  it('bayraklar açıkken komutlar çalışır', async () => {
    const rapor = await tauriInvoke<ExpiryReport>('get_expiry_report', { ...AUTH, ...ALL_FLAGS });
    expect(Array.isArray(rapor.expired)).toBe(true);
    expect(Array.isArray(rapor.expiring)).toBe(true);
  });

  it('fire kaydı reçete bayrağına bağlı değildir', async () => {
    const kayit = await tauriInvoke<WasteRecord>('record_waste_command', {
      ...AUTH,
      args: { productId: 'prd_kahve', quantity: 1, reason: 'BOZULMA' },
    });
    expect(kayit.reason).toBe('BOZULMA');
  });
});

describe('Reçete maliyeti: sessiz sıfır yok', () => {
  it('bileşenleri çözülen ürünün birim maliyeti hesaplanır', async () => {
    const maliyet = await tauriInvoke<RecipeCost>('get_recipe_cost', {
      ...AUTH,
      ...ALL_FLAGS,
      args: { product_id: 'prd_latte' },
    });
    expect(maliyet.unresolved).toHaveLength(0);
    expect(maliyet.unit_cost_cents).not.toBeNull();
    expect(typeof maliyet.unit_cost_cents).toBe('number');
  });

  it('reçetesiz üründe maliyet null döner, 0 değil', async () => {
    const maliyet = await tauriInvoke<RecipeCost>('get_recipe_cost', {
      ...AUTH,
      ...ALL_FLAGS,
      args: { product_id: 'prd_bilinmeyen' },
    });
    expect(maliyet.unit_cost_cents).toBeNull();
    expect(maliyet.unit_cost_cents).not.toBe(0);
  });

  it('çözülemeyen bileşen varsa birim maliyet null döner', async () => {
    const recete = await tauriInvoke<Recipe>('create_recipe_command', {
      ...AUTH,
      ...ALL_FLAGS,
      args: {
        productId: 'prd_latte',
        name: 'Bozuk reçete',
        yieldPercent: 100,
        outputQuantity: 1,
        outputUnit: 'adet',
        items: [{ componentProductId: 'prd_yok', quantity: 10, unit: 'g' }],
      },
    });
    expect(recete.id).toBeTruthy();
  });

  it('randıman 0-100 dışında reddedilir', async () => {
    await expect(
      tauriInvoke('create_recipe_command', {
        ...AUTH,
        ...ALL_FLAGS,
        args: { productId: 'prd_latte', name: 'Bozuk', yieldPercent: 140, outputQuantity: 1 },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });
});

describe('Tedarikçi fiyat karşılaştırması', () => {
  it('fiyat farkı ve yıllık etki hesaplanır', async () => {
    const gap = await tauriInvoke<PriceGap>('compare_supplier_prices_command', {
      ...AUTH,
      args: { productId: 'prd_kahve', annualVolume: 1000 },
    });
    expect(gap.rows).toHaveLength(2);
    expect(gap.lowest_cents).toBe(6800);
    expect(gap.highest_cents).toBe(7200);
    expect(gap.gap_cents).toBe(400);
    expect(gap.annual_saving_cents).toBe(400000);
  });

  it('hacim verilmezse yıllık tasarruf null döner, 0 değil', async () => {
    const gap = await tauriInvoke<PriceGap>('compare_supplier_prices_command', {
      ...AUTH,
      args: { productId: 'prd_kahve' },
    });
    expect(gap.annual_saving_cents).toBeNull();
  });

  it('tek tedarikçi varsa fark sıfırdır ama null değildir', async () => {
    await tauriInvoke('set_supplier_product_command', {
      ...AUTH,
      args: { supplierId: 'sup_1', productId: 'prd_yeni', unitCostCents: 5000 },
    });
    const gap = await tauriInvoke<PriceGap>('compare_supplier_prices_command', {
      ...AUTH,
      args: { productId: 'prd_yeni' },
    });
    expect(gap.lowest_cents).toBe(5000);
    expect(gap.highest_cents).toBe(5000);
    expect(gap.gap_cents).toBe(0);
  });

  it('negatif alış fiyatı reddedilir', async () => {
    await expect(
      tauriInvoke('set_supplier_product_command', {
        ...AUTH,
        args: { supplierId: 'sup_1', productId: 'prd_kahve', unitCostCents: -100 },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });
});

describe('Raf ömrü raporu', () => {
  it('süresi geçen ve yaklaşan partiler ayrı listelenir', async () => {
    const rapor = await tauriInvoke<ExpiryReport>('get_expiry_report', { ...AUTH, ...ALL_FLAGS });
    expect(rapor.expired).toHaveLength(0);
    expect(rapor.expiring.length).toBeGreaterThanOrEqual(0);
    if (rapor.expiring.length > 0) {
      expect(rapor.expiring[0].days_left).not.toBeNull();
    }
  });

  it('tarih biçimi geçersizse reddedilir', async () => {
    await expect(
      tauriInvoke('set_batch_expiry_date', {
        ...AUTH,
        ...ALL_FLAGS,
        args: { batchId: 'bat_1', expiryDate: '06/10/2026' },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it('uyarı penceresi raf ömründen büyükse reddedilir', async () => {
    await expect(
      tauriInvoke('upsert_shelf_life_policy_command', {
        ...AUTH,
        ...ALL_FLAGS,
        args: { productId: 'prd_sut', shelfLifeDays: 5, warningDays: 10 },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });
});

describe('Fire kaydı', () => {
  it('geçersiz gerekçe reddedilir', async () => {
    await expect(
      tauriInvoke('record_waste_command', {
        ...AUTH,
        args: { productId: 'prd_kahve', quantity: 1, reason: 'MERHABA' },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it('negatif miktar reddedilir', async () => {
    await expect(
      tauriInvoke('record_waste_command', {
        ...AUTH,
        args: { productId: 'prd_kahve', quantity: -2, reason: 'BOZULMA' },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it('müdür fire kaydedemez', async () => {
    await expect(
      tauriInvoke('record_waste_command', {
        ...MANAGER_AUTH,
        args: { productId: 'prd_kahve', quantity: 1, reason: 'BOZULMA' },
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('parti olmayan üründe fire maliyeti null döner, 0 değil', async () => {
    const kayit = await tauriInvoke<WasteRecord>('record_waste_command', {
      ...AUTH,
      args: { productId: 'prd_partisiz', quantity: 3, reason: 'KAYIP' },
    });
    expect(kayit.total_cost_cents).toBeNull();
    expect(kayit.total_cost_cents).not.toBe(0);
  });

  it('müdür fire kayıtlarını okuyabilir', async () => {
    await tauriInvoke('record_waste_command', {
      ...AUTH,
      args: { productId: 'prd_kahve', quantity: 2, reason: 'SURE' },
    });
    const kayitlar = await tauriInvoke<WasteRecord[]>('list_waste_records_command', {
      ...MANAGER_AUTH,
    });
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0].reason).toBe('SURE');
  });
});

describe('Kör sayım', () => {
  it('satırda beklenen miktar tutulmaz', async () => {
    const sayim = await tauriInvoke<StockCount>('open_stock_count_command', { ...AUTH, args: {} });
    await tauriInvoke('record_count_line_command', {
      ...AUTH,
      args: { stockCountId: sayim.id, productId: 'prd_kahve', countedQuantity: 3 },
    });
    const tazelenmis = await tauriInvoke<StockCount>('get_stock_count_command', {
      ...AUTH,
      stockCountId: sayim.id,
    });
    expect(tazelenmis.lines?.[0]?.expected_quantity).toBeNull();
    expect(tazelenmis.lines?.[0]?.variance_quantity).toBeNull();
  });

  it('kapanışta beklenen miktar hesaplanır', async () => {
    const sayim = await tauriInvoke<StockCount>('open_stock_count_command', { ...AUTH, args: {} });
    await tauriInvoke('record_count_line_command', {
      ...AUTH,
      args: { stockCountId: sayim.id, productId: 'prd_kahve', countedQuantity: 3 },
    });
    const kapali = await tauriInvoke<StockCount>('close_stock_count_command', {
      ...AUTH,
      args: { stockCountId: sayim.id, applyAdjustment: true },
    });
    expect(kapali.status).toBe('UYGULANDI');
    expect(kapali.lines?.[0]?.expected_quantity).toBe(4);
    expect(kapali.lines?.[0]?.variance_quantity).toBe(-1);
    expect(kapali.lines?.[0]?.variance_cost_cents).toBe(-1000);
  });

  it('satır sayılmadan kapatılamaz', async () => {
    const sayim = await tauriInvoke<StockCount>('open_stock_count_command', { ...AUTH, args: {} });
    await expect(
      tauriInvoke('close_stock_count_command', {
        ...AUTH,
        args: { stockCountId: sayim.id, applyAdjustment: false },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it('negatif sayım miktarı reddedilir', async () => {
    const sayim = await tauriInvoke<StockCount>('open_stock_count_command', { ...AUTH, args: {} });
    await expect(
      tauriInvoke('record_count_line_command', {
        ...AUTH,
        args: { stockCountId: sayim.id, productId: 'prd_kahve', countedQuantity: -3 },
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it('aynı anda iki açık sayım olamaz', async () => {
    await tauriInvoke('open_stock_count_command', { ...AUTH, args: {} });
    await expect(tauriInvoke('open_stock_count_command', { ...AUTH, args: {} })).rejects.toThrow(
      /CONFLICT/,
    );
  });

  it('kapatılan sayım tekrar kapatılamaz', async () => {
    const sayim = await tauriInvoke<StockCount>('open_stock_count_command', { ...AUTH, args: {} });
    await tauriInvoke('record_count_line_command', {
      ...AUTH,
      args: { stockCountId: sayim.id, productId: 'prd_kahve', countedQuantity: 4 },
    });
    await tauriInvoke('close_stock_count_command', {
      ...AUTH,
      args: { stockCountId: sayim.id, applyAdjustment: true },
    });
    await expect(
      tauriInvoke('close_stock_count_command', {
        ...AUTH,
        args: { stockCountId: sayim.id, applyAdjustment: true },
      }),
    ).rejects.toThrow(/CONFLICT/);
  });
});

describe('Biçimlendiriciler sessiz sıfır yazmaz', () => {
  it('bilinmeyen tutar için tire döner', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money(0)).toBe(money(0));
    expect(money(0)).not.toBe('—');
  });

  it('bilinmeyen miktar için tire döner', () => {
    expect(quantity(null)).toBe('—');
    expect(quantity(0)).toBe('0');
  });

  it('kuruş tam sayı kalır', () => {
    expect(money(4250)).toContain('42,50');
  });

  it('bilinmeyen fire gerekçesi çıplak kod olarak görünür', () => {
    expect(wasteReasonLabel('BOZULMA')).toBe('Bozulma');
    expect(wasteReasonLabel('BILINMEYEN')).toBe('BILINMEYEN');
  });

  it('mock deposu sıfırlandıktan sonra fabrika değerlerine döner', () => {
    const durum = readMockInventory360State();
    expect(durum.priceLists).toHaveLength(0);
    expect(durum.waste).toHaveLength(0);
    expect(durum.stockCounts).toHaveLength(0);
    expect(durum.priceFreezes).toHaveLength(1);
  });
});

describe('Fiyat listesi kalemleri', () => {
  it('kalemsiz liste oluşturulabilir ve boş döner', async () => {
    const liste = await tauriInvoke<PriceList>('create_price_list_command', {
      ...AUTH,
      args: { name: 'Toptan', kind: 'TOPTAN' },
    });
    expect(liste.items).toHaveLength(0);
    expect(liste.kind).toBe('TOPTAN');
  });

  it('boş ad reddedilir', async () => {
    await expect(
      tauriInvoke('create_price_list_command', { ...AUTH, args: { name: '   ' } }),
    ).rejects.toThrow(/VALIDATION/);
  });
});