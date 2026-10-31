import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { invokeIPC } from '../services/tauriClient';
import type { FinancialProfitSummary } from '../types/ledger';
import { sessionArgs } from './cariStore';

export const EXPENSE_CATEGORIES: Record<string, string> = {
  RENT: 'Kira',
  UTILITIES: 'Fatura',
  SUPPLIER: 'Tedarikçi',
  STAFF_ADVANCE: 'Personel Avansı',
  TAX: 'Vergi',
  PERSONAL: 'Şahsi',
  MAINTENANCE: 'Bakım',
  OTHER: 'Diğer',
};

export interface Expense {
  id: string;
  category: string;
  amountCents: number;
  paymentMethod: string;
  description: string | null;
  expenseDate: string;
  recurringId: string | null;
}

export interface BudgetRow {
  category: string;
  monthlyLimitCents: number;
  spentCents: number;
  remainingCents: number;
  usedPercent: number;
  isExceeded: boolean;
  isNearLimit: boolean;
}

export interface RecurringRow {
  id: string;
  title: string;
  category: string;
  amountCents: number;
  dueDay: number;
  isOverdue: boolean;
  isDueToday: boolean;
}

interface ExpenseStore {
  /** `YYYY-AA`: Finans bölümündeki tüm paneller bu ayı gösterir. */
  period: string;
  setPeriod: (period: string) => void;
  report: FinancialProfitSummary | null;
  expenses: Expense[] | null;
  budgets: BudgetRow[];
  recurring: RecurringRow[];
  error: string | null;
  load: () => Promise<void>;
  addExpense: (category: string, amountCents: number, paymentMethod: string, description: string, recurringId?: string) => Promise<void>;
  voidExpense: (id: string, reason: string) => Promise<void>;
  setBudget: (category: string, monthlyLimitCents: number) => Promise<void>;
  addRecurring: (title: string, category: string, amountCents: number, dueDay: number) => Promise<void>;
  removeRecurring: (id: string) => Promise<void>;
}

const two = (value: number) => String(value).padStart(2, '0');

export const monthKey = (date = new Date()) => `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
const today = (date = new Date()) => `${monthKey(date)}-${two(date.getDate())}`;

const lastDay = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return two(new Date(year, month, 0).getDate());
};

/** Tek gider yolu: Finans ve Kasa aynı komutu kullanır. */
export async function createExpense(category: string, amountCents: number, paymentMethod: string, description: string, recurringId?: string) {
  const { actorId, actorRole, tenantId } = sessionArgs();
  await invokeIPC('create_expense', {
    actorRole,
    payload: { tenantId, category, amountCents, paymentMethod, actorId, description, expenseDate: today(), recurringId },
  });
}

export const useExpenseStore = create<ExpenseStore>((set, get) => ({
  period: monthKey(),
  setPeriod: (period) => {
    if (!period) return;
    set({ period });
    void get().load();
  },
  report: null,
  expenses: null,
  budgets: [],
  recurring: [],
  error: null,

  // Okunamayan gider sıfır gösterilmez: liste boşaltılır, hata görünür.
  load: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const month = get().period;
    const startDate = `${month}-01`;
    const endDate = `${month}-${lastDay(month)}`;
    try {
      const report = actorRole === 'OWNER'
        ? await invokeIPC<FinancialProfitSummary>('get_financial_report', { actorRole, tenantId, startDate, endDate })
        : null;
      const [expenses, budgets, recurring] = await Promise.all([
        invokeIPC<Expense[]>('get_expenses', { actorRole, tenantId, startDate, endDate: `${endDate} 23:59:59` }),
        invokeIPC<BudgetRow[]>('get_budget_status', { actorRole, tenantId, asOf: startDate }),
        invokeIPC<RecurringRow[]>('get_recurring_expenses', { actorRole, tenantId, asOf: today() }),
      ]);
      set({ report, expenses, budgets, recurring, error: null });
    } catch (caught) {
      set({ report: null, expenses: null, budgets: [], recurring: [], error: errorText(caught) });
    }
  },

  addExpense: async (category, amountCents, paymentMethod, description, recurringId) => {
    await createExpense(category, amountCents, paymentMethod, description, recurringId);
    await get().load();
  },

  voidExpense: async (id, reason) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('void_expense', { expenseId: id, reason, actorId, actorRole, tenantId });
    await get().load();
  },

  setBudget: async (category, monthlyLimitCents) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_budget_limit', { category, monthlyLimitCents, actorId, actorRole, tenantId });
    await get().load();
  },

  addRecurring: async (title, category, amountCents, dueDay) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('save_recurring_expense', { title, category, amountCents, dueDay, actorId, actorRole, tenantId });
    await get().load();
  },

  removeRecurring: async (id) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('deactivate_recurring_expense', { id, actorId, actorRole, tenantId });
    await get().load();
  },
}));
