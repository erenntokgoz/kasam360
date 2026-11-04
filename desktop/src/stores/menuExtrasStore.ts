import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';

export interface ProductExtras {
  id: string;
  station: string | null;
  onWeb: boolean;
  displayOrder: number;
}

interface CategoryParent {
  id: string;
  parentId: string | null;
}

interface MenuExtrasStore {
  products: Record<string, ProductExtras>;
  parents: Record<string, string | null>;
  /** Kopyalanan ürün: yeni ürün formu bununla dolar. */
  copySource: string | null;
  setCopySource: (id: string | null) => void;
  load: () => Promise<void>;
  save: (input: { id: string; station: string | null; onWeb: boolean; imageUrl: string | null }) => Promise<void>;
  saveOrder: (ids: string[]) => Promise<void>;
  setParent: (id: string, parentId: string | null) => Promise<void>;
}

export const useMenuExtrasStore = create<MenuExtrasStore>((set, get) => ({
  products: {},
  parents: {},
  copySource: null,
  setCopySource: (copySource) => set({ copySource }),
  load: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const [products, categories] = await invokeIPC<[ProductExtras[], CategoryParent[]]>('get_menu_extras', { actorRole, tenantId });
    set({
      products: Object.fromEntries(products.map((item) => [item.id, item])),
      parents: Object.fromEntries(categories.map((item) => [item.id, item.parentId])),
    });
  },
  save: async (input) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_product_extras', { actorRole, tenantId, input });
    await get().load();
  },
  saveOrder: async (ids) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_product_order', { actorRole, tenantId, ids });
    await get().load();
  },
  setParent: async (id, parentId) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_category_parent', { actorRole, tenantId, id, parentId });
    await get().load();
  },
}));
