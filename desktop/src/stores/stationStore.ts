import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { useAuthStore } from './authStore';

export interface Station {
  id: string;
  name: string;
  printerName: string | null;
  userIds: string[];
}

interface StationStore {
  stations: Station[];
  load: () => Promise<void>;
  create: (name: string) => Promise<Station>;
}

export const stationKey = (name: string) => name.toLocaleUpperCase('tr-TR');

export const useStationStore = create<StationStore>((set) => ({
  stations: [],
  load: async () => {
    const { tenantId } = sessionArgs();
    set({ stations: await invokeIPC<Station[]>('get_station_settings', { tenantId }) });
  },
  create: async (rawName) => {
    const name = rawName.trim();
    if (!name) throw new Error('İstasyon adı zorunludur.');
    const auth = useAuthStore.getState();
    if (!auth.isAuthenticated || auth.isLocked || auth.mustChangePin || !['OWNER', 'MANAGER'].includes(auth.user?.role ?? '')) {
      throw new Error('İstasyon oluşturmak için yetkili oturum açın.');
    }
    const { actorRole, tenantId } = sessionArgs();
    const input = { id: null, name, printerName: null, userIds: [] };
    const id = await invokeIPC<string>('save_station', { actorRole, tenantId, input });
    if (!id) throw new Error('İstasyon kimliği alınamadı.');
    const station = { ...input, id };
    set((state) => ({ stations: [...state.stations, station] }));
    return station;
  },
}));
