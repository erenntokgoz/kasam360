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
          set({ staffList: data.map((d: any) => ({ id: d.id || d._id, name: d.name, role: d.role, totalPaid: d.totalPaid || 0 })) });
        } catch (error) {
          console.error('[useStaffStore.fetchStaff]', error);
          throw error;
        }
      },

      addStaff: async (name, role) => {
        const { staffList } = get();
        const trimmedName = name.trim();
        const existing = staffList.find(s => s.name.toLowerCase() === trimmedName.toLowerCase());
        if (existing) {
          throw new Error('Bu personel zaten rehberde kayıtlı.');
        }
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
          await get().fetchStaff();
        } catch (error) {
          console.error('[useStaffStore.updateStaff]', error);
          throw error;
        }
      },

      removeStaff: async (id) => {
        try {
          await deleteEntry(id);
          await get().fetchStaff();
        } catch (error) {
          console.error('[useStaffStore.removeStaff]', error);
          throw error;
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