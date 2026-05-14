import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { v4 as uuidv4 } from 'uuid';

export interface QueueItem {
  id: string; // uuid
  url: string;
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  headers?: any;
  createdAt: number;
}

interface OfflineQueueState {
  queue: QueueItem[];
  isProcessing: boolean;
  addToQueue: (item: Omit<QueueItem, 'id' | 'createdAt'>) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  processQueue: () => Promise<void>;
}

export const useOfflineQueueStore = create<OfflineQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      isProcessing: false,

      addToQueue: (item) => {
        const newItem: QueueItem = {
          ...item,
          id: uuidv4(),
          createdAt: Date.now(),
        };
        set((state) => ({ queue: [...state.queue, newItem] }));
      },

      removeFromQueue: (id) => {
        set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
      },

      clearQueue: () => set({ queue: [] }),

      processQueue: async () => {
        const { queue, isProcessing, removeFromQueue } = get();

        if (isProcessing || queue.length === 0) return;

        // İnternet bağlantısını kontrol et
        const netInfo = await NetInfo.fetch();
        if (!netInfo.isConnected) {
          return;
        }

        set({ isProcessing: true });

        // Kuyruktaki işlemleri sırayla gönder
        for (const item of queue) {
          try {
            await api.request({
              url: item.url,
              method: item.method,
              data: item.data,
              headers: item.headers,
            });
            // Başarılı olursa kuyruktan çıkar
            removeFromQueue(item.id);
          } catch (error: any) {
            console.error(`[OfflineQueueStore] Failed to process item ${item.id}:`, error);
            // 400x hataları (örneğin validasyon) ise bir daha denemeye gerek olmayabilir
            if (error.response && error.response.status >= 400 && error.response.status < 500) {
               removeFromQueue(item.id); // Kalıcı hata, listeden sil
            }
            // 500x sunucu hataları veya ağ hataları ise listede kalsın, sonra tekrar dener.
          }
        }

        set({ isProcessing: false });
      },
    }),
    {
      name: 'offline-queue-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// NetInfo listener'ı kurarak internet geldiğinde processQueue'yi otomatik tetikleyebiliriz
NetInfo.addEventListener((state: any) => {
  if (state.isConnected) {
    useOfflineQueueStore.getState().processQueue();
  }
});
