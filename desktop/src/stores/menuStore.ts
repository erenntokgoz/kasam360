// Menü deposu
// Finansal hesaplamalar INTEGER kuruş üzerinden yapılır. Fail-closed prensibi geçerlidir.
// Tüm IPC çağrıları Tauri generate_handler sözleşmesine ve backend arayüzüne birebir uyar.

import { create } from 'zustand';
import type { ModifierGroupDto, MenuState } from '../types/menu';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { useFeatureStore } from './featureStore';
import { mapRecipeCost } from '../lib/recipeCost';
import { mapCategory, mapPriceList, mapProduct } from '../lib/menuWire';
import { createMenuModifierActions } from './menuModifierActions';
import { createMenuPriceActions } from './menuPriceActions';
import { createMenuRecipeActions } from './menuRecipeActions';

export { parseMoneyToCents } from '../lib/moneyParser';
export type { MenuBulkPreviewItem } from '../types/menu';

function getAuthContext() {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || auth.mustChangePin || !auth.user) {
    throw new Error('Oturum açılmalı.');
  }
  return {
    actorRole: auth.user.role,
    actorId: auth.user.userId,
    tenantId: auth.user.tenantId,
    activeModules: auth.user.activeModules ?? [],
  };
}

export const useMenuStore = create<MenuState>((set, get) => ({
  products: [],
  categories: [],
  modifierGroups: [],
  productModifierGroupIds: [],
  modifierGroupsLoading: false,
  priceLists: [],
  selectedProductId: null,
  detailMode: 'view',
  activeTab: 'KATALOG',
  detailTab: 'temel',
  searchQuery: '',
  filters: {
    tukendi: false,
    satista: false,
    satisDisi: false,
    categoryId: null,
  },
  busy: false,
  error: null,
  productRecipe: null,
  bulkPreview: [],

  clearError: () => set({ error: null }),
  setSelectedProductId: (id) => {
    set({ selectedProductId: id, detailMode: 'view', productModifierGroupIds: [] });
    if (id) {
      get().loadProductRecipe(id);
      get().loadProductModifierGroupIds(id);
    } else set({ productRecipe: null });
  },
  setDetailMode: (mode) =>
    set({ detailMode: mode, selectedProductId: mode === 'new' ? null : get().selectedProductId,
      productModifierGroupIds: mode === 'new' ? [] : get().productModifierGroupIds }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setDetailTab: (tab) => set({ detailTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setCategoryFilter: (categoryId) =>
    set((state) => ({ filters: { ...state.filters, categoryId } })),
  toggleFilterTukendi: () =>
    set((state) => ({
      filters: { ...state.filters, tukendi: !state.filters.tukendi },
    })),
  toggleFilterSatista: () =>
    set((state) => ({
      filters: { ...state.filters, satista: !state.filters.satista },
    })),
  toggleFilterSatisDisi: () =>
    set((state) => ({
      filters: { ...state.filters, satisDisi: !state.filters.satisDisi },
    })),

  loadCatalog: async () => {
    try {
      const { actorRole, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      const [prods, cats, mods, prLists] = await Promise.all([
        invokeIPC<Parameters<typeof mapProduct>[0][]>('get_management_products', { actorRole, tenantId }),
        invokeIPC<Parameters<typeof mapCategory>[0][]>('get_management_categories', { actorRole, tenantId }),
        actorRole === 'OWNER'
          ? invokeIPC<ModifierGroupDto[]>('get_modifier_groups', { actorRole, tenantId })
          : Promise.resolve([]),
        useFeatureStore.getState().isEnabled('feat_dynamic_pricing')
          ? invokeIPC<Parameters<typeof mapPriceList>[0][]>('list_price_lists', { actorRole, tenantId })
          : Promise.resolve([]),
      ]);

      const firstSale = prods.map(mapProduct).find((product) => !product.isRaw);
      const selected = get().selectedProductId || (firstSale?.id ?? null);
      set({
        products: prods.map(mapProduct),
        categories: cats.map(mapCategory),
        modifierGroups: mods,
        priceLists: prLists.map(mapPriceList),
        selectedProductId: selected,
      });

      if (selected) {
        get().loadProductRecipe(selected);
        if (actorRole === 'OWNER') get().loadProductModifierGroupIds(selected);
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ busy: false });
    }
  },

  saveProduct: async (productData) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      if (get().detailMode === 'new') {
        const priceCents = productData.priceCents;
        if (typeof priceCents !== 'number' || !Number.isSafeInteger(priceCents) || priceCents < 0) {
          throw new Error('Yeni ürün için geçerli kuruş fiyatı gerekli.');
        }
        const createdWire = await invokeIPC<Parameters<typeof mapProduct>[0]>('create_product', {
          actorRole,
          actorId,
          tenantId,
          categoryId: productData.categoryId,
          name: productData.name,
          priceCents,
          // Hammadde satışa açılmaz; sunucu da aynı kuralı uygular.
          isActive: priceCents > 0 && !productData.isRaw,
          barcode: productData.barcode || null,
          description: productData.description || null,
          imageUrl: productData.imageUrl || null,
          sku: productData.sku || null,
          color: productData.color || null,
          is86: false,
          stockoutReason: null,
          stockUnit: productData.stockUnit ?? 'adet',
          taxRateBp: productData.taxRateBp ?? 1000,
          isRaw: productData.isRaw ?? false,
        });
        const created = mapProduct(createdWire);
        set((state) => ({
          products: [created, ...state.products],
          selectedProductId: created.id,
          detailMode: 'view',
        }));
      } else {
        const prodId = get().selectedProductId;
        if (!prodId) throw new Error('Güncellenecek ürün seçilmedi');
        const current = get().products.find((p) => p.id === prodId);
        const updatedWire = await invokeIPC<Parameters<typeof mapProduct>[0]>('update_product', {
          actorRole,
          actorId,
          tenantId,
          id: prodId,
          categoryId: productData.categoryId || current?.categoryId,
          name: productData.name || current?.name,
          priceCents: productData.priceCents ?? current?.priceCents,
          isActive: current?.isActive ?? true,
          isRaw: productData.isRaw ?? current?.isRaw ?? false,
          barcode: productData.barcode ?? current?.barcode ?? null,
          description: productData.description ?? current?.description ?? null,
          imageUrl: current?.imageUrl ?? null,
          sku: current?.sku ?? null,
          color: current?.color ?? null,
          is86: current?.is86 ?? false,
          stockoutReason: current?.stockoutReason ?? null,
          stockUnit: productData.stockUnit ?? current?.stockUnit ?? 'adet',
          taxRateBp: productData.taxRateBp ?? current?.taxRateBp ?? 1000,
        });
        const updated = mapProduct(updatedWire);
        set((state) => ({
          products: state.products.map((p) => (p.id === prodId ? updated : p)),
        }));
      }
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  toggleProductActive: async (productId) => {
    const prod = get().products.find((p) => p.id === productId);
    if (!prod) return false;

    const newStatus = !prod.isActive;
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      await invokeIPC('update_product_status', {
        actorRole,
        actorId,
        tenantId,
        id: productId,
        isActive: newStatus,
      });
      set((state) => ({
        products: state.products.map((p) =>
          p.id === productId ? { ...p, isActive: newStatus } : p
        ),
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  toggleProduct86: async (productId, is86, reason) => {
    try {
      const { actorRole, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      await invokeIPC('set_product_86d_command', {
        actorRole,
        tenantId,
        args: {
          productId,
          is86d: is86,
          reason: reason || (is86 ? 'Tükendi' : null),
        },
      });
      set((state) => ({
        products: state.products.map((p) =>
          p.id === productId ? { ...p, is86, stockoutReason: reason } : p
        ),
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  deleteProduct: async (productId) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      await invokeIPC('delete_product', { actorRole, actorId, tenantId, id: productId });
      set((state) => {
        const nextProducts = state.products.filter((p) => p.id !== productId);
        return {
          products: nextProducts,
          selectedProductId: nextProducts.find((p) => !p.isRaw)?.id ?? null,
        };
      });
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  createCategory: async (name, defaultStation = 'BAR', onCreated) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      const displayOrder = get().categories.length + 1;
      const createdWire = await invokeIPC<Parameters<typeof mapCategory>[0]>('create_category', {
        actorRole,
        actorId,
        tenantId,
        name,
        displayOrder,
        defaultStation,
        icon: null,
      });
      const created = mapCategory(createdWire);
      set((state) => ({ categories: [...state.categories, created] }));
      onCreated?.(created);
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  updateCategory: async (category, name, defaultStation) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      set({ busy: true, error: null });
      await invokeIPC('update_category', {
        actorRole,
        actorId,
        tenantId,
        id: category.id,
        name,
        displayOrder: category.displayOrder,
        icon: category.icon ?? null,
        defaultStation,
      });
      set((state) => ({
        categories: state.categories.map((c) => (c.id === category.id ? { ...c, name, defaultStation } : c)),
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  deleteCategory: async (categoryId) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      if (get().products.some((product) => product.categoryId === categoryId)) {
        throw new Error('Ürün içeren kategori silinemez. Önce ürünleri taşıyın.');
      }
      set({ busy: true, error: null });
      await invokeIPC('delete_category', { actorRole, actorId, tenantId, id: categoryId });
      set((state) => ({
        categories: state.categories.filter((c) => c.id !== categoryId),
        products: state.products.filter((p) => p.categoryId !== categoryId),
        filters: {
          ...state.filters,
          categoryId: state.filters.categoryId === categoryId ? null : state.filters.categoryId,
        },
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  loadProductRecipe: async (productId) => {
    set({ productRecipe: null, error: null });
    try {
      const { actorRole, tenantId, activeModules } = getAuthContext();
      const cost = await invokeIPC<Parameters<typeof mapRecipeCost>[0]>('get_recipe_cost', {
        actorRole,
        tenantId,
        activeModules,
        args: { productId },
      });
      if (get().selectedProductId === productId) set({ productRecipe: mapRecipeCost(cost) });
    } catch (err: unknown) {
      if (get().selectedProductId === productId && !String(err).includes('NOT_FOUND')) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  },

  loadProductModifierGroupIds: async (productId) => {
    set({ productModifierGroupIds: [], modifierGroupsLoading: true });
    try {
      const { actorRole, tenantId } = getAuthContext();
      // Ürün seçenek bağı yalnız sahibe açıktır; başka rolde sorulmaz, hata bandı çıkmaz.
      if (actorRole !== 'OWNER' && actorRole !== 'MASTER') return;
      const ids = await invokeIPC<string[]>('get_product_modifier_group_ids', {
        actorRole, tenantId, productId,
      });
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
        throw new Error('Ürün seçenekleri okunamadı.');
      }
      if (get().selectedProductId === productId) set({ productModifierGroupIds: ids });
    } catch (err: unknown) {
      if (get().selectedProductId === productId) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (get().selectedProductId === productId) set({ modifierGroupsLoading: false });
    }
  },

  setProductModifierGroupIds: async (productId, groupIds) => {
    try {
      const { actorRole, actorId, tenantId } = getAuthContext();
      if (get().selectedProductId !== productId || get().modifierGroupsLoading) return false;
      set({ modifierGroupsLoading: true, error: null });
      await invokeIPC('set_product_modifier_groups', {
        actorRole, actorId, tenantId, productId, groupIds,
      });
      if (get().selectedProductId === productId) set({ productModifierGroupIds: groupIds });
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      if (get().selectedProductId === productId) set({ modifierGroupsLoading: false });
    }
  },

  ...createMenuPriceActions(set, get, getAuthContext),
  ...createMenuModifierActions(set, getAuthContext),
  ...createMenuRecipeActions(set, get, getAuthContext),
}));
