import { create } from 'zustand';
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
import { useLogStore } from './useLogStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DebtState {
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
  makePayment: (debtId: string, amount: number) => Promise<PayDebtResult>;
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

export const useDebtStore = create<DebtState>((set, get) => ({
  ...initialState,

  /**
   * Sets the active type filter and re-fetches page 1.
   */
  setFilter: (filter: DebtType | null) => {
    set({ activeFilter: filter });
    get().fetchDebts(1);
  },

  /**
   * Fetches a page of debts using the current filter.
   * Page 1 replaces the list; subsequent pages append (infinite scroll).
   */
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
      const message = err instanceof Error ? err.message : 'Failed to fetch debts.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Creates a new debt, prepends it to the local list.
   */
  addDebt: async (payload: CreateDebtPayload) => {
    set({ isCreating: true, error: null });
    try {
      const created = await createDebt(payload);

      set((state) => ({
        debts: [created, ...state.debts],
        isCreating: false,
      }));

      // Re-fetch to get updated summary
      get().fetchDebts(1).catch(() => {});

      const actionText = created.type === 'TAKEN'
        ? `${created.entityName} kişisinden ${(created.totalAmount / 100).toLocaleString('tr-TR')}₺ borç alındı.`
        : `${created.entityName} kişisine ${(created.totalAmount / 100).toLocaleString('tr-TR')}₺ borç verildi.`;
      useLogStore.getState().addLog(actionText, 'success');

      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create debt.';
      set({ error: message, isCreating: false });
      throw err;
    }
  },

  /**
   * Records a partial/full payment on a debt.
   * Optimistically updates the local debt record.
   * Also triggers a ledger refresh since a Transaction is created server-side.
   */
  makePayment: async (debtId: string, amount: number) => {
    set({ isPaying: true, error: null });
    try {
      const result = await payDebt(debtId, amount);

      // Update the debt in the local array
      set((state) => ({
        debts: state.debts.map((d) =>
          d._id === debtId ? result.debt : d,
        ),
        isPaying: false,
      }));

      // Re-fetch to get updated summary totals
      get().fetchDebts(1).catch(() => {});

      const debt = result.debt;
      const actionText = debt.type === 'TAKEN'
        ? `${debt.entityName} kişisine olan borcun ${(amount / 100).toLocaleString('tr-TR')}₺ kadarı ödendi.`
        : `${debt.entityName} kişisindeki alacağın ${(amount / 100).toLocaleString('tr-TR')}₺ kadarı tahsil edildi.`;
      useLogStore.getState().addLog(actionText, 'info');

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process payment.';
      set({ error: message, isPaying: false });
      throw err;
    }
  },

  /**
   * Updates a debt and re-fetches.
   */
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
      const message = err instanceof Error ? err.message : 'Failed to update debt.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Deletes a debt and re-fetches.
   */
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
      const message = err instanceof Error ? err.message : 'Failed to delete debt.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Convenience: re-fetches page 1 with current filter.
   */
  refreshDebts: async () => {
    await get().fetchDebts(1);
  },

  clearError: () => set({ error: null }),

  /**
   * Resets to initial state (e.g. on logout).
   */
  reset: () => set(initialState),
}));
