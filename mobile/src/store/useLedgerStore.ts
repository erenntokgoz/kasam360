import { create } from 'zustand';
import {
  getTransactions,
  createTransaction,
  Transaction,
  TransactionType,
  CreateTransactionPayload,
  TransactionPagination,
} from '../api/transactionService';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LedgerState {
  transactions: Transaction[];
  pagination: TransactionPagination | null;

  /** All values in integer cents/kuruş */
  totalIncome: number;
  totalExpense: number;
  balance: number;

  isLoading: boolean;
  isCreating: boolean;
  error: string | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  fetchTransactions: (page?: number, limit?: number, type?: TransactionType) => Promise<void>;
  addTransaction: (payload: CreateTransactionPayload) => Promise<Transaction>;
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
  fetchTransactions: async (page = 1, limit = 20, type?: TransactionType) => {
    set({ isLoading: true, error: null });
    try {
      const result = await getTransactions(page, limit, type);

      set((state) => ({
        transactions:
          page === 1
            ? result.transactions
            : [...state.transactions, ...result.transactions],
        pagination: result.pagination,
        totalIncome: result.summary.totalIncome,
        totalExpense: result.summary.totalExpense,
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
          balance: newIncome - newExpense,
          isCreating: false,
        };
      });

      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create transaction.';
      set({ error: message, isCreating: false });
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
