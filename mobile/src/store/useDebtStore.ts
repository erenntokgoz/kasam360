import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '../utils/storage';
import {
  getDebts,
  createDebt,
  payDebt,
  Debt,
  DebtType,
  CreateDebtPayload,
  DebtPagination,
  DebtSummary,
  PayDebtResult,
  UpdateDebtPayload,
  updateDebt as updateDebtApi,
  deleteDebt as deleteDebtApi,
} from '../api/debtService';
export type { Debt } from '../api/debtService';
import { useLogStore } from './useLogStore';
import { useNotificationStore } from './useNotificationStore';
import { useLedgerStore } from './useLedgerStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DebtState {
  debts: Debt[];
  pagination: DebtPagination | null;
  summary: DebtSummary | null;

  /** Active filter — null means "show all" */
  activeFilter: DebtType | null;

  isLoading: boolean;
  isCreating: boolean;
  isPaying: boolean;
  error: string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  setFilter: (filter: DebtType | null) => void;
  fetchDebts: (page?: number, limit?: number) => Promise<void>;
  addDebt: (payload: CreateDebtPayload) => Promise<Debt>;
  updateDebt: (id: string, payload: UpdateDebtPayload) => Promise<Debt>;
  deleteDebt: (id: string) => Promise<void>;
  makePayment: (debtId: string, amount: number, method?: string) => Promise<PayDebtResult>;
  refreshDebts: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  debts: [] as Debt[],
  pagination: null as DebtPagination | null,
  summary: null as DebtSummary | null,
  activeFilter: null as DebtType | null,
  isLoading: false,
  isCreating: false,
  isPaying: false,
  error: null as string | null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDebtStore = create<DebtState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setFilter: (filter: DebtType | null) => {
        set({ activeFilter: filter });
        get().fetchDebts(1);
      },

      fetchDebts: async (page = 1, limit = 20) => {
        set({ isLoading: true, error: null });
        try {
          const { activeFilter } = get();
          const result = await getDebts(page, limit, activeFilter ?? undefined);

          set((state) => ({
            debts: page === 1 ? result.debts : [...state.debts, ...result.debts],
            pagination: result.pagination,
            summary: result.summary,
            isLoading: false,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Borçlar alınamadı.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      addDebt: async (payload: CreateDebtPayload) => {
        set({ isCreating: true, error: null });
        try {
          const created = await createDebt(payload);

          set((state) => ({
            debts: [created, ...state.debts],
            isCreating: false,
          }));

          get().fetchDebts(1).catch(() => {});
          if (payload.isCash) {
            useLedgerStore.getState().fetchTransactions(1).catch(() => {});
          }

          const actionText = created.type === 'TAKEN'
            ? `${created.entityName} kişisinden ${(created.totalAmount / 100).toLocaleString('tr-TR')}₺ borç alındı.`
            : `${created.entityName} kişisine ${(created.totalAmount / 100).toLocaleString('tr-TR')}₺ borç verildi.`;
          useLogStore.getState().addLog(actionText, 'success');

          useNotificationStore.getState().addNotification({
            title: created.type === 'TAKEN' ? 'Borç Alındı' : 'Borç Verildi',
            body: actionText,
            type: 'DEBT',
          });

          return created;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Borç oluşturulamadı.';
          set({ error: message, isCreating: false });
          throw err;
        }
      },

      makePayment: async (debtId: string, amount: number, method?: string) => {
        set({ isPaying: true, error: null });
        try {
          const result = await payDebt(debtId, amount, method);

          set((state) => ({
            debts: state.debts.map((d) =>
              d._id === debtId ? result.debt : d,
            ),
            isPaying: false,
          }));

          get().fetchDebts(1).catch(() => {});
          useLedgerStore.getState().fetchTransactions(1).catch(() => {});

          const debt = result.debt;
          const actionText = debt.type === 'TAKEN'
            ? `${debt.entityName} kişisine olan borcun ${(amount / 100).toLocaleString('tr-TR')}₺ kadarı ödendi.`
            : `${debt.entityName} kişisindeki alacağın ${(amount / 100).toLocaleString('tr-TR')}₺ kadarı tahsil edildi.`;
          useLogStore.getState().addLog(actionText, 'info');

          useNotificationStore.getState().addNotification({
            title: debt.type === 'TAKEN' ? 'Borç Ödemesi Yapıldı' : 'Alacak Tahsil Edildi',
            body: actionText,
            type: 'DEBT',
          });

          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ödeme işlemi başarısız oldu.';
          set({ error: message, isPaying: false });
          throw err;
        }
      },

      updateDebt: async (id: string, payload: UpdateDebtPayload) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await updateDebtApi(id, payload);
          set((state) => ({
            debts: state.debts.map((d) => (d._id === id ? updated : d)),
            isLoading: false,
          }));
          get().fetchDebts(1).catch(() => {});
          return updated;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Borç güncellenemedi.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      deleteDebt: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          await deleteDebtApi(id);
          set((state) => ({
            debts: state.debts.filter((d) => d._id !== id),
            isLoading: false,
          }));
          get().fetchDebts(1).catch(() => {});
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Borç silinemedi.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      refreshDebts: async () => {
        await get().fetchDebts(1);
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: StorageKeys.DEBTS,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
