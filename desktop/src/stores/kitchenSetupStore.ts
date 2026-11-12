import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';

// Mutfak ekranı yalnız işletmede etkin bir KITCHEN kullanıcısı varsa anlamlıdır.
// Durum okunamazsa `null` kalır ve menü gizlenmez: gizleme kolaylıktır, güvenlik kapısı değildir.
interface KitchenSetupStore {
  hasKitchenUser: boolean | null;
  load: (tenantId: string | undefined) => Promise<void>;
}

export const useKitchenSetupStore = create<KitchenSetupStore>((set) => ({
  hasKitchenUser: null,
  load: async (tenantId) => {
    if (!tenantId) return;
    try {
      const setup = await invokeIPC<{ hasKitchenUser: boolean } | null>('get_kitchen_setup', { tenantId });
      if (setup) set({ hasKitchenUser: setup.hasKitchenUser });
    } catch {
      set({ hasKitchenUser: null });
    }
  },
}));
