import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '../utils/storage';
import {
  getTransactions,
  createTransaction,
  Transaction,
  CreateTransactionPayload,
  TransactionPagination,
  TransactionFilters,
  UpdateTransactionPayload,
  updateTransaction as updateTxApi,
  deleteTransaction as deleteTxApi,
} from '../api/transactionService';
import { useLogStore } from './useLogStore';
import { useNotificationStore } from './useNotificationStore';
import { useStaffStore } from './useStaffStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LedgerState {
  transactions: Transaction[];
  pagination: TransactionPagination | null;

  /** All values in integer cents/kuruş */
  totalIncome: number;
  totalExpense: number;
  totalDebt: number;
  totalReceivable: number;
  balance: number;

  isLoading: boolean;
  isCreating: boolean;
  pendingOperations: CreateTransactionPayload[];
  error: string | null;
  // ── Actions ────────────────────────────────────────────────────────────────
  fetchTransactions: (page?: number, limit?: number, filters?: TransactionFilters) => Promise<void>;
  addTransaction: (payload: CreateTransactionPayload) => Promise<Transaction>;
  updateTransaction: (id: string, payload: UpdateTransactionPayload) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  processOfflineQueue: () => Promise<void>;
  refreshLedger: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  transactions: [] as Transaction[],
  pagination: null as TransactionPagination | null,
  totalIncome: 0,
  totalExpense: 0,
  totalDebt: 0,
  totalReceivable: 0,
  balance: 0,
  isLoading: false,
  isCreating: false,
  pendingOperations: [] as CreateTransactionPayload[],
  error: null as string | null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set, get) => ({
      ...initialState,

      fetchTransactions: async (page = 1, limit = 20, filters?: TransactionFilters) => {
        set({ isLoading: true, error: null });
        try {
          const result = await getTransactions(page, limit, filters);

          const transactions = result.transactions.map(t => ({ ...t, id: t._id }));
          set((state) => ({
            transactions:
              page === 1
                ? transactions
                : [...state.transactions, ...transactions],
            pagination: result.pagination,
            totalIncome: result.summary.totalIncome,
            totalExpense: result.summary.totalExpense,
            totalDebt: result.summary.totalDebt,
            totalReceivable: result.summary.totalReceivable,
            balance: result.summary.balance,
            isLoading: false,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'İşlemler alınamadı.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      addTransaction: async (payload: CreateTransactionPayload) => {
        set({ isCreating: true, error: null });
        try {
          const created = await createTransaction(payload);

          set((state) => {
            const newIncome =
              created.type === 'INCOME'
                ? state.totalIncome + created.amount
                : state.totalIncome;
            const newExpense =
              created.type === 'EXPENSE'
                ? state.totalExpense + created.amount
                : state.totalExpense;

            return {
              transactions: [created, ...state.transactions],
              totalIncome: newIncome,
              totalExpense: newExpense,
              balance: state.balance + (created.type === 'INCOME' ? created.amount : -created.amount),
              isCreating: false,
            };
          });

          // Async background sync for derived balances
          useStaffStore.getState().fetchStaff().catch(() => {});
          import('./useContactStore').then(m => m.useContactStore.getState().fetchContacts().catch(() => {}));

          const amountStr = (created.amount / 100).toLocaleString('tr-TR') + '₺';
          const categoryText = created.category ? `[${created.category}] ` : '';
          const actionText = created.description 
            ? `${categoryText}${created.description} (${amountStr})`
            : `${categoryText}${amountStr} tutarında ${created.type === 'INCOME' ? 'gelir eklendi' : 'gider kaydedildi'}.`;
          
          useLogStore.getState().addLog(actionText, 'success');

          useNotificationStore.getState().addNotification({
            title: created.type === 'INCOME' ? 'Yeni Gelir Eklendi' : 'Yeni Gider Eklendi',
            body: actionText,
            type: 'INFO',
          });

          return created;
        } catch (err) {
          const isNetworkError = err instanceof Error && (err.message.includes('network') || err.message.includes('timeout'));
          if (isNetworkError) {
            // Mock transaction for UI
            const mockTx: Transaction = { 
              _id: 'temp-' + Date.now(), 
              ...payload, 
              createdAt: new Date().toISOString(),
              transactionDate: payload.transactionDate || new Date().toISOString(),
            } as any;

            set(state => ({
              pendingOperations: [...state.pendingOperations, payload],
              transactions: [mockTx, ...state.transactions],
              balance: state.balance + (payload.type === 'INCOME' ? payload.amount : -payload.amount),
              isCreating: false
            }));

            useNotificationStore.getState().addNotification({
              title: 'Çevrimdışı Mod',
              body: 'Bağlantı hatası. İşlem internet geldiğinde senkronize edilecek.',
              type: 'WARNING'
            });
            return mockTx;
          }
          const message = err instanceof Error ? err.message : 'İşlem oluşturulamadı.';
          set({ error: message, isCreating: false });
          throw err;
        }
      },

      processOfflineQueue: async () => {
        const { pendingOperations } = get();
        if (pendingOperations.length === 0) return;

        const remaining: CreateTransactionPayload[] = [];
        for (const op of pendingOperations) {
          try {
            await createTransaction(op);
          } catch (err) {
            remaining.push(op);
          }
        }
        set({ pendingOperations: remaining });
        if (remaining.length === 0 && pendingOperations.length > 0) {
          get().fetchTransactions(1).catch(() => {});
        }
      },

      updateTransaction: async (id: string, payload: UpdateTransactionPayload) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await updateTxApi(id, payload);
          set((state) => ({
            transactions: state.transactions.map((t) => (t._id === id ? updated : t)),
            isLoading: false,
          }));
          get().fetchTransactions(1).catch(() => {});
          
          useStaffStore.getState().fetchStaff().catch(() => {});
          import('./useContactStore').then(m => m.useContactStore.getState().fetchContacts().catch(() => {}));
          return updated;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'İşlem güncellenemedi.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      deleteTransaction: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const tx = get().transactions.find((t) => t._id === id);
          if (tx?.category === 'Personel Gideri') {
            useStaffStore.getState().fetchStaff().catch(() => {});
          }

          await deleteTxApi(id);
          set((state) => ({
            transactions: state.transactions.filter((t) => t._id !== id),
            isLoading: false,
          }));
          get().fetchTransactions(1).catch(() => {});
          
          useStaffStore.getState().fetchStaff().catch(() => {});
          import('./useContactStore').then(m => m.useContactStore.getState().fetchContacts().catch(() => {}));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'İşlem silinemedi.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      refreshLedger: async () => {
        await get().fetchTransactions(1);
      },

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: StorageKeys.LEDGER,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
