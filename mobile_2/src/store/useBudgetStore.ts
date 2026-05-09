import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../utils/storage';

const zustandStorage = {
  setItem: (name: string, value: string) => storage.set(name, value),
  getItem: (name: string) => storage.getString(name) ?? null,
  removeItem: (name: string) => storage.remove(name),
};

interface BudgetStore {
  monthlyLimit: number;
  warningThreshold: number;
  setMonthlyLimit: (amount: number) => void;
  setWarningThreshold: (percent: number) => void;
}

export const useBudgetStore = create<BudgetStore>()(
  persist(
    (set) => ({
      monthlyLimit: 0,
      warningThreshold: 80,
      setMonthlyLimit: (amount) => set({ monthlyLimit: amount }),
      setWarningThreshold: (percent) => set({ warningThreshold: percent }),
    }),
    {
      name: 'budget-storage',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
