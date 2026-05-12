import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringItem {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  method: 'CASH' | 'POS' | 'IBAN';
  category: string;
  description?: string;
  frequency: Frequency;
  nextDate: string; // ISO string
  active: boolean;
  lastNotified?: string; // ISO string
}

interface RecurringStore {
  recurrings: RecurringItem[];
  addRecurring: (item: Omit<RecurringItem, 'id' | 'nextDate' | 'active'>) => void;
  removeRecurring: (id: string) => void;
  toggleRecurring: (id: string) => void;
  checkAndNotify: () => RecurringItem[];
  lastCheckRun?: string;
}

const getNextDate = (frequency: Frequency, fromDate: Date = new Date()) => {
  const next = new Date(fromDate);
  if (frequency === 'DAILY') next.setDate(next.getDate() + 1);
  if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  if (frequency === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
  return next.toISOString();
};

export const useRecurringStore = create<RecurringStore>()(
  persist(
    (set, get) => ({
      recurrings: [],
      lastCheckRun: undefined,
      addRecurring: (item) => {
        const newItem: RecurringItem = {
          ...item,
          id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
          active: true,
          nextDate: getNextDate(item.frequency),
        };
        set((state) => ({ recurrings: [...state.recurrings, newItem] }));
      },
      removeRecurring: (id) => {
        set((state) => ({ recurrings: state.recurrings.filter((r) => r.id !== id) }));
      },
      toggleRecurring: (id) => {
        set((state) => ({
          recurrings: state.recurrings.map((r) =>
            r.id === id ? { ...r, active: !r.active } : r
          ),
        }));
      },
      checkAndNotify: () => {
        const { recurrings, lastCheckRun } = get();
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        
        // Mühürleme (Sealing): Eğer bugün zaten bir kontrol yapıldıysa boş dön
        if (lastCheckRun === todayStr) return [];

        const dueItems = recurrings.filter(r => {
          if (!r.active) return false;
          const nextDateStr = r.nextDate.split('T')[0];
          const isDue = nextDateStr <= todayStr;
          const alreadyNotified = r.lastNotified?.split('T')[0] === todayStr;
          return isDue && !alreadyNotified;
        });

        if (dueItems.length > 0) {
          set((state) => ({
             lastCheckRun: todayStr,
             recurrings: state.recurrings.map((r) => {
               if (dueItems.some(d => d.id === r.id)) {
                 return { ...r, lastNotified: now.toISOString(), nextDate: getNextDate(r.frequency, now) };
               }
               return r;
             })
          }));
        } else {
          // Hiç due item yoksa bile "bugün kontrol edildi" olarak mühürle
          set({ lastCheckRun: todayStr });
        }

        return dueItems;
      },
    }),
    {
      name: 'recurring-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
