import { create } from 'zustand';
import { getDirectory, createEntry, updateEntry, deleteEntry } from '../api/directoryService';

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
  addPaymentToStaff: (id: string, amount: number) => Promise<void>;
}

export const useStaffStore = create<StaffStore>()(
  (set, get) => ({
    staffList: [],

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
      if (staffList.find(s => s.name.toLowerCase() === name.toLowerCase())) {
        return;
      }
      try {
        const newEntry = await createEntry({ name, type: 'STAFF', role, totalPaid: 0 });
        set({ staffList: [...staffList, { id: newEntry._id, name: newEntry.name, role: newEntry.role, totalPaid: newEntry.totalPaid }] });
      } catch (error) {
        console.error('[useStaffStore.addStaff]', error);
      }
    },

    updateStaff: async (id, updates) => {
      try {
        await updateEntry(id, updates);
        set((state) => ({
          staffList: state.staffList.map(s => s.id === id ? { ...s, ...updates } : s)
        }));
      } catch (error) {
        console.error('[useStaffStore.updateStaff]', error);
      }
    },

    removeStaff: async (id) => {
      try {
        await deleteEntry(id);
        set((state) => ({
          staffList: state.staffList.filter(s => s.id !== id)
        }));
      } catch (error) {
        console.error('[useStaffStore.removeStaff]', error);
      }
    },

    addPaymentToStaff: async (id, amount) => {
      try {
        const staff = get().staffList.find(s => s.id === id);
        if (!staff) return;
        const newTotal = staff.totalPaid + amount;
        await updateEntry(id, { totalPaid: newTotal });
        set((state) => ({
          staffList: state.staffList.map(s => 
            s.id === id ? { ...s, totalPaid: newTotal } : s
          )
        }));
      } catch (error) {
        console.error('[useStaffStore.addPaymentToStaff]', error);
      }
    },
  })
);
