import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
