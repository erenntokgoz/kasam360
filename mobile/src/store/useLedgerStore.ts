import { create } from 'zustand';
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
  error: string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  fetchTransactions: (page?: number, limit?: number, filters?: TransactionFilters) => Promise<void>;
  addTransaction: (payload: CreateTransactionPayload) => Promise<Transaction>;
  updateTransaction: (id: string, payload: UpdateTransactionPayload) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
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
  error: null as string | null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useLedgerStore = create<LedgerState>((set, get) => ({
  ...initialState,

  /**
   * Fetches a page of transactions and updates the summary totals.
   * First page replaces the list; subsequent pages append (infinite scroll).
   */
  fetchTransactions: async (page = 1, limit = 20, filters?: TransactionFilters) => {
    set({ isLoading: true, error: null });
    try {
      const result = await getTransactions(page, limit, filters);

      set((state) => ({
        transactions:
          page === 1
            ? result.transactions
            : [...state.transactions, ...result.transactions],
        pagination: result.pagination,
        totalIncome: result.summary.totalIncome,
        totalExpense: result.summary.totalExpense,
        totalDebt: result.summary.totalDebt,
        totalReceivable: result.summary.totalReceivable,
        balance: result.summary.balance,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch transactions.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Creates a transaction, prepends it to the local list,
   * and updates running totals optimistically.
   */
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

      const amountStr = (created.amount / 100).toLocaleString('tr-TR') + '₺';
      const categoryText = created.category ? `[${created.category}] ` : '';
      const actionText = created.description 
        ? `${categoryText}${created.description} (${amountStr})`
        : `${categoryText}${amountStr} tutarında ${created.type === 'INCOME' ? 'gelir eklendi' : 'gider kaydedildi'}.`;
      
      useLogStore.getState().addLog(actionText, 'success');

      // Add Notification
      useNotificationStore.getState().addNotification({
        title: created.type === 'INCOME' ? 'Yeni Gelir Eklendi' : 'Yeni Gider Eklendi',
        body: actionText,
        type: 'INFO',
      });

      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create transaction.';
      set({ error: message, isCreating: false });
      throw err;
    }
  },

  /**
   * Updates an existing transaction and re-fetches to sync totals.
   */
  updateTransaction: async (id: string, payload: UpdateTransactionPayload) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await updateTxApi(id, payload);
      set((state) => ({
        transactions: state.transactions.map((t) => (t._id === id ? updated : t)),
        isLoading: false,
      }));
      get().fetchTransactions(1).catch(() => {});
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update transaction.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Deletes a transaction and re-fetches to sync totals.
   */
  deleteTransaction: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      // Sync staff totalPaid if this was a personnel expense
      const tx = get().transactions.find((t) => t._id === id);
      if (tx?.category === 'Personel Gideri' && tx?.description) {
        const { staffList, updateStaff } = useStaffStore.getState();
        const staffName = tx.description.split(' kişisine')[0];
        const staff = staffList.find((s) => s.name === staffName);
        if (staff) {
          const newTotal = Math.max(0, staff.totalPaid - tx.amount);
          updateStaff(staff.id, { totalPaid: newTotal }).catch(() => {});
        }
      }

      await deleteTxApi(id);
      set((state) => ({
        transactions: state.transactions.filter((t) => t._id !== id),
        isLoading: false,
      }));
      get().fetchTransactions(1).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete transaction.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Convenience: re-fetches page 1 to get the freshest data + totals.
   */
  refreshLedger: async () => {
    await get().fetchTransactions(1);
  },

  clearError: () => set({ error: null }),

  /**
   * Resets the store to initial state (e.g. on logout).
   */
  reset: () => set(initialState),
}));
