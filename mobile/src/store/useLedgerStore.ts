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
import { generateUUID } from '../utils/uuid';

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
  /** Actions */
  fetchTransactions: (cursor?: string | null, limit?: number, filters?: TransactionFilters) => Promise<void>;
  addTransaction: (payload: CreateTransactionPayload) => Promise<Transaction>;
  updateTransaction: (id: string, payload: UpdateTransactionPayload) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  processOfflineQueue: () => Promise<void>;
  refreshLedger: () => Promise<void>;
  syncLocked: boolean;
  authError: boolean;
  breakSyncLock: () => void;
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
  syncLocked: false,
  authError: false,
  error: null as string | null,
};

const TRANSACTION_LIMIT = 200;

// ─── Store ───────────────────────────────────────────────────────────────────

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set, get) => ({
      ...initialState,

      fetchTransactions: async (cursor: string | null = null, limit = 20, filters?: TransactionFilters) => {
        set({ isLoading: true, error: null, authError: false, syncLocked: false });
        try {
          const result = await getTransactions(cursor, limit, filters);
          
          set((state) => ({
            transactions:
              cursor === null
                ? result.transactions.slice(0, TRANSACTION_LIMIT)
                : [...state.transactions, ...result.transactions].slice(0, TRANSACTION_LIMIT),
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
              transactions: [created, ...state.transactions].slice(0, TRANSACTION_LIMIT),
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
            const tempId = generateUUID();
            const payloadWithSync = { ...payload, syncId: tempId };
            
            // Mock transaction for UI
            const mockTx: Transaction = { 
              _id: tempId, 
              ...payloadWithSync, 
              createdAt: new Date().toISOString(),
              transactionDate: payload.transactionDate || new Date().toISOString(),
            } as any;

            set(state => ({
              pendingOperations: [...state.pendingOperations, payloadWithSync],
              transactions: [mockTx, ...state.transactions].slice(0, TRANSACTION_LIMIT),
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
        const { pendingOperations, syncLocked } = get();
        if (pendingOperations.length === 0 || syncLocked) return;

        set({ syncLocked: true });
        const remaining: CreateTransactionPayload[] = [];
        
        for (const op of pendingOperations) {
          try {
            const created = await createTransaction(op);
            
            // Eşleştirip ID'yi güncelleme logic'i
            if (op.syncId) {
              set((state) => ({
                transactions: state.transactions.map((t) => 
                  t._id === op.syncId ? { ...t, _id: created._id } : t
                )
              }));
            }
          } catch (err: any) {
            const status = err?.status;
            
            if (status === 401) {
              // Auth hatası: Kuyruğu durdur ve kilitli bırak
              set({ syncLocked: true, authError: true });
              return; 
            }
            
            if (status >= 500 || !status) {
              // Server hatası veya network: Sonra tekrar dene
              remaining.push(op);
            } else {
              // 400 gibi hatalarda işlemi kuyruktan at (ya da logla)
              console.error('Kritik senkronizasyon hatası:', err);
            }
          }
        }

        set({ 
          pendingOperations: remaining,
          syncLocked: false 
        });

        if (remaining.length === 0 && pendingOperations.length > 0) {
          get().fetchTransactions(null).catch(() => {});
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
          get().fetchTransactions(null).catch(() => {});
          
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
          get().fetchTransactions(null).catch(() => {});
          
          useStaffStore.getState().fetchStaff().catch(() => {});
          import('./useContactStore').then(m => m.useContactStore.getState().fetchContacts().catch(() => {}));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'İşlem silinemedi.';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      refreshLedger: async () => {
        await get().fetchTransactions(null);
      },

      breakSyncLock: () => set({ syncLocked: false, authError: false }),

      clearError: () => set({ error: null }),

      reset: () => set(initialState),
    }),
    {
      name: StorageKeys.LEDGER,
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Rehydration anında bekleyen işlemleri otomatik tetikle
          state.processOfflineQueue().catch(() => {});
        }
      },
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // Gelecekteki migration'lar için hazırlık
          return persistedState;
        }
        return persistedState;
      },
    }
  )
);
