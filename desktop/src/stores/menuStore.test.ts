import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleManagementMockIPC } from '../test/managementIpcFixture';
import { parseMoneyToCents, useMenuStore } from './menuStore';
import { useAuthStore } from './authStore';

vi.mock('../services/tauriClient', () => ({
  invokeIPC: async (command: string, args: Record<string, unknown> = {}) =>
    handleManagementMockIPC(command, args),
  isTauri: () => false,
}));

describe('Menu Money Parser & Calculations', () => {
  it('parses Turkish formatted currency string to integer cents', () => {
    expect(parseMoneyToCents('45,00')).toBe(4500);
    expect(parseMoneyToCents('45,50')).toBe(4550);
    expect(parseMoneyToCents('45,99')).toBe(4599);
    expect(parseMoneyToCents('120')).toBe(12000);
    expect(parseMoneyToCents(' 35,00 TL ')).toBe(3500);
    expect(parseMoneyToCents('250,50 ₺')).toBe(25050);
  });

  it('parses standard dot formatted decimal to integer cents', () => {
    expect(parseMoneyToCents('45.00')).toBe(4500);
    expect(parseMoneyToCents('12.34')).toBe(1234);
    expect(parseMoneyToCents(5000)).toBe(5000);
  });

  it('rejects negative or invalid money strings', () => {
    expect(() => parseMoneyToCents('-45,00')).toThrow();
    expect(() => parseMoneyToCents('abc')).toThrow();
    expect(() => parseMoneyToCents(-100)).toThrow();
  });

  it('handles edge case strings and zero values', () => {
    expect(parseMoneyToCents('0')).toBe(0);
    expect(parseMoneyToCents('0,00')).toBe(0);
    expect(parseMoneyToCents('0.50')).toBe(50);
    expect(parseMoneyToCents('45,5')).toBe(4550);
    expect(parseMoneyToCents('  100  ')).toBe(10000);
    expect(() => parseMoneyToCents('12.34.56')).toThrow();
    expect(() => parseMoneyToCents('12,34,56')).toThrow();
    expect(() => parseMoneyToCents('45,123')).toThrow();
  });
});

describe('Menu Store Actions & Bulk Pricing', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { userId: 'usr_test', name: 'Test', role: 'OWNER',
      tenantId: 'ten_01', activeModules: ['feat_recipe_bom'] }, isAuthenticated: true,
      isLocked: false, mustChangePin: false });
    useMenuStore.setState({
      products: [
        {
          id: 'p1',
          name: 'Espresso',
          categoryId: 'cat_coffee',
          priceCents: 4500,
          isActive: true,
          is86: false,
          isRaw: false,
        },
        {
          id: 'p2',
          name: 'Latte',
          categoryId: 'cat_coffee',
          priceCents: 6500,
          isActive: true,
          is86: true,
          isRaw: false,
        },
        {
          id: 'p3',
          name: 'Burger',
          categoryId: 'cat_food',
          priceCents: 22000,
          isActive: false,
          is86: false,
          isRaw: false,
        },
      ],
      categories: [
        { id: 'cat_coffee', name: 'Kahveler', displayOrder: 1, defaultStation: 'BAR' },
        { id: 'cat_food', name: 'Yiyecekler', displayOrder: 2, defaultStation: 'MUTFAK' },
      ],
      modifierGroups: [],
      priceLists: [],
      selectedProductId: null,
      detailMode: 'view',
      bulkPreview: [],
      productRecipe: null,
      filters: {
        tukendi: false,
        satista: false,
        satisDisi: false,
        categoryId: null,
      },
    });
  });

  it('oturum yokken menü verisini yüklemez', async () => {
    useAuthStore.getState().logout();
    useMenuStore.setState({ products: [] });
    await useMenuStore.getState().loadCatalog();
    expect(useMenuStore.getState().products).toEqual([]);
  });

  it('zorunlu PIN değişimi bitmeden menüyü yüklemez', async () => {
    useAuthStore.setState({ mustChangePin: true });
    useMenuStore.setState({ products: [] });
    await useMenuStore.getState().loadCatalog();
    expect(useMenuStore.getState().products).toEqual([]);
  });

  it('calculates percentage bulk price preview correctly', () => {
    const store = useMenuStore.getState();
    store.calculateBulkPreview('PERCENTAGE', 1000); // %10 zam, baz puan

    const preview = useMenuStore.getState().bulkPreview;
    expect(preview).toHaveLength(3);

    // 4500 * 1.10 = 4950
    const p1 = preview.find((p) => p.id === 'p1');
    expect(p1?.newPriceCents).toBe(4950);

    // 6500 * 1.10 = 7150
    const p2 = preview.find((p) => p.id === 'p2');
    expect(p2?.newPriceCents).toBe(7150);
  });

  it('calculates fixed TL amount bulk price preview correctly', () => {
    const store = useMenuStore.getState();
    store.calculateBulkPreview('FIXED_AMOUNT', 1000); // +10,00 TL = +1000 kuruş

    const preview = useMenuStore.getState().bulkPreview;
    const p1 = preview.find((p) => p.id === 'p1');
    expect(p1?.newPriceCents).toBe(5500);
  });

  it('filters bulk price by category correctly', () => {
    const store = useMenuStore.getState();
    store.calculateBulkPreview('PERCENTAGE', 2000, 'cat_coffee');

    const preview = useMenuStore.getState().bulkPreview;
    expect(preview).toHaveLength(2);
    expect(preview.every((p) => p.id === 'p1' || p.id === 'p2')).toBe(true);
  });

  it('kategori önizlemesinde satış dışı ürünü saymaz', () => {
    useMenuStore.getState().calculateBulkPreview('PERCENTAGE', 1000, 'cat_food');
    expect(useMenuStore.getState().bulkPreview).toEqual([]);
  });

  it('girdi değiştiğinde eski fiyat önizlemesini temizler', () => {
    useMenuStore.getState().calculateBulkPreview('PERCENTAGE', 1000);
    expect(useMenuStore.getState().bulkPreview.length).toBeGreaterThan(0);
    useMenuStore.getState().clearBulkPreview();
    expect(useMenuStore.getState().bulkPreview).toEqual([]);
  });

  it('applies bulk price update and refreshes catalog', async () => {
    const store = useMenuStore.getState();
    store.calculateBulkPreview('PERCENTAGE', 1500);
    expect(useMenuStore.getState().bulkPreview.length).toBeGreaterThan(0);

    const res = await store.applyBulkPrice({
      updateType: 'PERCENTAGE',
      value: 1500,
    });
    expect(res).toBeDefined();
    // Bulk preview should be cleared after apply
    expect(useMenuStore.getState().bulkPreview).toHaveLength(0);
  });

  it('toggles quick filters properly', () => {
    const store = useMenuStore.getState();
    expect(store.filters.tukendi).toBe(false);

    store.toggleFilterTukendi();
    expect(useMenuStore.getState().filters.tukendi).toBe(true);

    store.toggleFilterSatista();
    expect(useMenuStore.getState().filters.satista).toBe(true);

    store.setCategoryFilter('cat_coffee');
    expect(useMenuStore.getState().filters.categoryId).toBe('cat_coffee');
  });

  it('creates and deletes modifier groups correctly', async () => {
    const store = useMenuStore.getState();
    const created = await store.createModifierGroup('Sos Tercihi', 0, 2, false);
    expect(created).toBe(true);

    const groups = useMenuStore.getState().modifierGroups;
    expect(groups.length).toBeGreaterThanOrEqual(1);

    const addedGroup = groups[groups.length - 1];
    expect(addedGroup.name).toBe('Sos Tercihi');

    // Add option to group
    const optAdded = await store.addModifierOption(addedGroup.id, 'Acı Sos', 1500);
    expect(optAdded).toBe(true);

    const updatedGroup = useMenuStore
      .getState()
      .modifierGroups.find((g) => g.id === addedGroup.id);
    expect(updatedGroup?.options).toHaveLength(1);
    expect(updatedGroup?.options[0].name).toBe('Acı Sos');
    expect(updatedGroup?.options[0].priceCents).toBe(1500);

    // Delete group
    const deleted = await store.deleteModifierGroup(addedGroup.id);
    expect(deleted).toBe(true);
    const remaining = useMenuStore
      .getState()
      .modifierGroups.find((g) => g.id === addedGroup.id);
    expect(remaining).toBeUndefined();
  });

  it('ürüne seçenek gruplarını kaydeder ve seçimi yeniden yükler', async () => {
    const store = useMenuStore.getState();
    await store.loadCatalog();
    const productId = useMenuStore.getState().selectedProductId;
    expect(productId).toBeTruthy();
    if (!productId) return;
    const created = await store.createModifierGroup('Ekstralar', 0, 2, false);
    expect(created).toBe(true);
    const groups = useMenuStore.getState().modifierGroups;
    const groupId = groups[groups.length - 1]?.id;
    expect(groupId).toBeTruthy();
    if (!groupId) return;

    await store.loadProductModifierGroupIds(productId);
    const saved = await store.setProductModifierGroupIds(productId, [groupId]);
    expect(saved).toBe(true);
    useMenuStore.setState({ productModifierGroupIds: [] });
    await store.loadProductModifierGroupIds(productId);
    expect(useMenuStore.getState().productModifierGroupIds).toEqual([groupId]);
  });

  it('reçeteyi oluşturur, bilinmeyen maliyeti korur ve pasife alır', async () => {
    const store = useMenuStore.getState();
    await store.loadCatalog();
    const [product, ingredient] = useMenuStore.getState().products;
    expect(product).toBeDefined();
    expect(ingredient).toBeDefined();
    store.setSelectedProductId(product.id);
    const created = await store.createRecipe({
      productId: product.id,
      name: `${product.name} reçetesi`,
      yieldPercent: 100,
      outputQuantity: 1,
      outputUnit: 'adet',
      notes: null,
      items: [{ componentProductId: ingredient.id, quantity: 1, unit: 'adet',
        wastePercent: 0, notes: null }],
    });
    expect(created).toBe(true);
    const cost = useMenuStore.getState().productRecipe;
    expect(cost?.totalCostCents).toBeNull();
    expect(cost?.unresolvedCount).toBe(1);
    expect(cost?.recipeId).toBeTruthy();
    if (!cost) return;
    expect(await store.deactivateRecipe(product.id, cost.recipeId)).toBe(true);
    expect(useMenuStore.getState().productRecipe).toBeNull();
  });

  it('creates and deletes categories and resets active filter', async () => {
    const store = useMenuStore.getState();
    const ok = await store.createCategory('Tatlılar', 'TATLI');
    expect(ok).toBe(true);

    const categories = useMenuStore.getState().categories;
    const cat = categories.find((c) => c.name === 'Tatlılar');
    expect(cat).toBeDefined();
    expect(cat?.defaultStation).toBe('TATLI');

    if (cat) {
      store.setCategoryFilter(cat.id);
      expect(useMenuStore.getState().filters.categoryId).toBe(cat.id);

      const delOk = await store.deleteCategory(cat.id);
      expect(delOk).toBe(true);
      expect(useMenuStore.getState().categories.find((c) => c.id === cat.id)).toBeUndefined();
      // Filter should be reset to null
      expect(useMenuStore.getState().filters.categoryId).toBeNull();
    }
  });

  it('ürün içeren kategoriyi ve ürünlerini silmez', async () => {
    const ok = await useMenuStore.getState().deleteCategory('cat_coffee');
    expect(ok).toBe(false);
    expect(useMenuStore.getState().categories.some((c) => c.id === 'cat_coffee')).toBe(true);
    expect(useMenuStore.getState().products.some((p) => p.categoryId === 'cat_coffee')).toBe(true);
  });

  it('creates and deletes price lists correctly', async () => {
    const store = useMenuStore.getState();
    const ok = await store.createPriceList('VIP Özel', 'Özel müşteriler için');
    expect(ok).toBe(true);

    const lists = useMenuStore.getState().priceLists;
    const pl = lists.find((l) => l.name === 'VIP Özel');
    expect(pl).toBeDefined();

    if (pl) {
      const delOk = await store.deletePriceList(pl.id);
      expect(delOk).toBe(true);
      expect(useMenuStore.getState().priceLists.find((l) => l.id === pl.id)).toBeUndefined();
    }
  });

  it('creates, edits, toggles and deletes products correctly with description', async () => {
    const store = useMenuStore.getState();
    store.setDetailMode('new');

    const ok = await store.saveProduct({
      name: 'Americano',
      categoryId: 'cat_coffee',
      priceCents: 5000,
      barcode: '1234567890123',
      description: 'Sıcak su ile inceltilmiş espresso lezzeti',
    });
    expect(ok).toBe(true);

    const products = useMenuStore.getState().products;
    const created = products.find((p) => p.name === 'Americano');
    expect(created).toBeDefined();
    expect(created?.priceCents).toBe(5000);
    expect(created?.description).toBe('Sıcak su ile inceltilmiş espresso lezzeti');

    if (created) {
      // Edit product
      store.setSelectedProductId(created.id);
      const editOk = await store.saveProduct({
        name: 'Americano Double',
        categoryId: 'cat_coffee',
        priceCents: 6000,
        description: 'Çift shot sıcak su ile inceltilmiş espresso',
      });
      expect(editOk).toBe(true);
      const edited = useMenuStore.getState().products.find((p) => p.id === created.id);
      expect(edited?.name).toBe('Americano Double');
      expect(edited?.priceCents).toBe(6000);

      // Toggle 86 status
      await store.toggleProduct86(created.id, true, 'Çekirdek bitti');
      const p86 = useMenuStore.getState().products.find((p) => p.id === created.id);
      expect(p86?.is86).toBe(true);
      expect(p86?.stockoutReason).toBe('Çekirdek bitti');

      // Toggle active status
      await store.toggleProductActive(created.id);
      const pActive = useMenuStore.getState().products.find((p) => p.id === created.id);
      expect(pActive?.isActive).toBe(false);

      // Delete product
      const delOk = await store.deleteProduct(created.id);
      expect(delOk).toBe(true);
      expect(useMenuStore.getState().products.find((p) => p.id === created.id)).toBeUndefined();
    }
  });

  it('aynı adlı kategorilerde yeni kaydın kimliğini çağırana verir', async () => {
    const onCreated = vi.fn();
    const store = useMenuStore.getState();
    expect(await store.createCategory('Kahve', '', onCreated)).toBe(true);
    const categories = useMenuStore.getState().categories;
    const saved = categories[categories.length - 1];
    expect(saved?.id).toBeTruthy();
    expect(onCreated).toHaveBeenCalledWith(saved);
  });

  it('reçete yoksa satış fiyatından sahte maliyet üretmez', async () => {
    const store = useMenuStore.getState();
    await store.loadProductRecipe('p1');
    expect(useMenuStore.getState().productRecipe).toBeNull();
  });

  it('fiyatsız yeni ürünü ikinci bir kapatma komutuna ihtiyaç duymadan satışa kapalı oluşturur', async () => {
    useMenuStore.getState().setDetailMode('new');
    expect(await useMenuStore.getState().saveProduct({ name: 'Fiyatsız hammadde', categoryId: 'cat_coffee', priceCents: 0, stockUnit: 'kg' })).toBe(true);
    const state = useMenuStore.getState();
    expect(state.products.find((product) => product.id === state.selectedProductId)?.isActive).toBe(false);
  });

  it('oluşturulan seçenek grubunun kimliğini bağlama akışına verir', async () => {
    const onCreated = vi.fn();
    expect(await useMenuStore.getState().createModifierGroup('Sos', 0, 1, false, onCreated)).toBe(true);
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String), name: 'Sos' }));
  });

  it('kesirli veya çelişkili seçenek sınırlarıyla grup oluşturmaz', async () => {
    expect(await useMenuStore.getState().createModifierGroup('Sos', 1, 0, true)).toBe(false);
    expect(await useMenuStore.getState().createModifierGroup('Sos', 0.5, 2, true)).toBe(false);
  });
});
