import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { invokeIPC } from '../services/tauriClient';
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
  expenses: Expense[] | null;
  budgets: BudgetRow[];
  recurring: RecurringRow[];
  error: string | null;
  load: () => Promise<void>;
  addExpense: (category: string, amountCents: number, paymentMethod: string, description: string) => Promise<void>;
  setBudget: (category: string, monthlyLimitCents: number) => Promise<void>;
  addRecurring: (title: string, category: string, amountCents: number, dueDay: number) => Promise<void>;
  removeRecurring: (id: string) => Promise<void>;
}

const two = (value: number) => String(value).padStart(2, '0');

export const monthKey = (date = new Date()) => `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
const today = (date = new Date()) => `${monthKey(date)}-${two(date.getDate())}`;

export const useExpenseStore = create<ExpenseStore>((set, get) => ({
  expenses: null,
  budgets: [],
  recurring: [],
  error: null,

  // Okunamayan gider sıfır gösterilmez: liste boşaltılır, hata görünür.
  load: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const month = monthKey();
    try {
      const [expenses, budgets, recurring] = await Promise.all([
        invokeIPC<Expense[]>('get_expenses', { actorRole, tenantId, startDate: `${month}-01`, endDate: `${month}-31 23:59:59` }),
        invokeIPC<BudgetRow[]>('get_budget_status', { actorRole, tenantId, asOf: `${month}-01` }),
        invokeIPC<RecurringRow[]>('get_recurring_expenses', { actorRole, tenantId, asOf: today() }),
      ]);
      set({ expenses, budgets, recurring, error: null });
    } catch (caught) {
      set({ expenses: null, budgets: [], recurring: [], error: errorText(caught) });
    }
  },

  addExpense: async (category, amountCents, paymentMethod, description) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('create_expense', {
      actorRole,
      payload: { tenantId, category, amountCents, paymentMethod, actorId, description, expenseDate: today() },
    });
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
