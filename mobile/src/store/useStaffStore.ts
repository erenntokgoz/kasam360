import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDirectory, createEntry, updateEntry, deleteEntry } from '../api/directoryService';
import { StorageKeys } from '../utils/storage';

export interface Staff {
  id: string;
  name: string;
  role?: string;
  totalPaid: number;
}

interface StaffStore {
  staffList: Staff[];
  fetchStaff: () => Promise<void>;
  addStaff: (name: string, role?: string) => Promise<void>;
  updateStaff: (id: string, updates: Partial<Staff>) => Promise<void>;
  removeStaff: (id: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  staffList: [],
};

export const useStaffStore = create<StaffStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      fetchStaff: async () => {
        try {
          const data = await getDirectory('STAFF');
          set({ staffList: data.map(d => ({ id: d._id, name: d.name, role: d.role, totalPaid: d.totalPaid })) });
        } catch (error) {
          console.error('[useStaffStore.fetchStaff]', error);
        }
      },

      addStaff: async (name, role) => {
        const { staffList } = get();
        const trimmedName = name.trim();
        const existing = staffList.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
        if (existing) return;
        try {
          await createEntry({ name: trimmedName, type: 'STAFF', role, totalPaid: 0 });
          await get().fetchStaff();
        } catch (error) {
          console.error('[useStaffStore.addStaff]', error);
          throw error;
        }
      },

      updateStaff: async (id, updates) => {
        try {
          await updateEntry(id, updates);
          get().fetchStaff().catch(() => {});
        } catch (error) {
          console.error('[useStaffStore.updateStaff]', error);
        }
      },

      removeStaff: async (id) => {
        try {
          await deleteEntry(id);
          await get().fetchStaff();
        } catch (error) {
          console.error('[useStaffStore.removeStaff]', error);
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: StorageKeys.STAFF || 'kasam360-staff',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
