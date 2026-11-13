import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';

/** Mutfakta hazır olup masaya götürülmemiş tek kalem. */
export interface PendingDelivery {
  itemId: string;
  orderId: string;
  tableName: string;
  productName: string;
  quantity: number;
  readySeconds: number;
}

interface DeliveryStore {
  items: PendingDelivery[];
  loadError: string | null;
  isServing: boolean;
  load: () => Promise<void>;
  serve: (itemIds: string[]) => Promise<boolean>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Eski bir okuma, daha yeni bir okumanın sonucunu ezmesin.
let loadRequest = 0;

export const useDeliveryStore = create<DeliveryStore>((set, get) => ({
  items: [],
  loadError: null,
  isServing: false,

  load: async () => {
    const request = ++loadRequest;
    try {
      const { actorRole, tenantId } = sessionArgs();
      const items = await invokeIPC<PendingDelivery[]>('list_pending_deliveries', { tenantId, actorRole });
      if (request === loadRequest) set({ items, loadError: null });
    } catch (error) {
      // Liste okunamadıysa boş görünmez: "teslim bekleyen yok" ile "okunamadı" ayrı durumlardır.
      if (request === loadRequest) set({ loadError: errorText(error) });
    }
  },

  // Sunucu yazmadan kalem listeden düşmez; başka cihaz önce teslim ettiyse liste yenilenir.
  serve: async (itemIds) => {
    if (itemIds.length === 0 || get().isServing) return false;
    set({ isServing: true });
    let failure: string | null = null;
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC<number>('mark_items_served', { itemIds, tenantId, actorId, actorRole });
    } catch (error) {
      failure = errorText(error);
    }
    set({ isServing: false });
    await get().load();
    // Yenileme başarılı olsa da teslim hatası kaybolmaz: kullanıcı neden değiştiğini görmeli.
    if (failure) set({ loadError: failure });
    return failure === null;
  },
}));
