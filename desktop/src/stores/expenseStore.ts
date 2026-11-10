import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { utcOffsetMinutes } from '../lib/dateRange';
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

/** Listede gösterilen etiketler. Personel ücreti ödemeden otomatik yazılır; elle seçilen kategorilere girmez. */
export const EXPENSE_LABELS: Record<string, string> = { ...EXPENSE_CATEGORIES, STAFF_PAY: 'Personel Ücreti' };

export interface Expense {
  id: string;
  category: string;
  amountCents: number;
  paymentMethod: string;
  description: string | null;
  expenseDate: string;
  recurringId: string | null;
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
  /** `YYYY-AA`: gider, sabit gider ve kâr panelleri bu ayı gösterir. */
  period: string;
  setPeriod: (period: string) => void;
  report: FinancialProfitSummary | null;
  expenses: Expense[] | null;
  recurring: RecurringRow[];
  error: string | null;
  load: () => Promise<void>;
  addExpense: (category: string, amountCents: number, paymentMethod: string, description: string, recurringId?: string) => Promise<void>;
  voidExpense: (id: string, reason: string) => Promise<void>;
  editExpense: (old: Expense, category: string, amountCents: number, paymentMethod: string, description: string) => Promise<void>;
  addRecurring: (title: string, category: string, amountCents: number, dueDay: number) => Promise<void>;
  updateRecurring: (id: string, title: string, category: string, amountCents: number, dueDay: number) => Promise<void>;
  removeRecurring: (id: string) => Promise<void>;
}

const two = (value: number) => String(value).padStart(2, '0');

export const monthKey = (date = new Date()) => `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
const today = (date = new Date()) => `${monthKey(date)}-${two(date.getDate())}`;

const lastDay = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return two(new Date(year, month, 0).getDate());
};

/** "Diğer" kategorisi ne olduğunu söylemez; açıklama olmadan kayıt anlamsızdır. */
export const needsDescription = (category: string, description: string) =>
  category === 'OTHER' && description.trim() === '';

/** Tek gider yolu: Finans ve Kasa aynı komutu kullanır. */
export async function createExpense(category: string, amountCents: number, paymentMethod: string, description: string, recurringId?: string, expenseDate?: string) {
  const { actorId, actorRole, tenantId } = sessionArgs();
  await invokeIPC('create_expense', {
    actorRole,
    payload: { tenantId, category, amountCents, paymentMethod, actorId, description, expenseDate: expenseDate ?? today(), recurringId },
  });
}

let loadRequest = 0;

export const useExpenseStore = create<ExpenseStore>((set, get) => ({
  period: monthKey(),
  setPeriod: (period) => {
    if (!period) return;
    set({ period });
    void get().load();
  },
  report: null,
  expenses: null,
  recurring: [],
  error: null,

  // Okunamayan gider sıfır gösterilmez: liste boşaltılır, hata görünür.
  // Eski ayın geç gelen yanıtı yeni seçimi ezmez.
  load: async () => {
    const request = ++loadRequest;
    const { actorRole, tenantId } = sessionArgs();
    const month = get().period;
    const startDate = `${month}-01`;
    const endDate = `${month}-${lastDay(month)}`;
    try {
      const report = actorRole === 'OWNER'
        ? await invokeIPC<FinancialProfitSummary>('get_financial_report', { actorRole, tenantId, startDate, endDate, utcOffsetMinutes: utcOffsetMinutes() })
        : null;
      const [expenses, recurring] = await Promise.all([
        invokeIPC<Expense[]>('get_expenses', { actorRole, tenantId, startDate, endDate: `${endDate} 23:59:59` }),
        invokeIPC<RecurringRow[]>('get_recurring_expenses', { actorRole, tenantId, asOf: today() }),
      ]);
      if (request === loadRequest) set({ report, expenses, recurring, error: null });
    } catch (caught) {
      if (request === loadRequest) set({ report: null, expenses: null, recurring: [], error: errorText(caught) });
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

  // Para kaydı üzerine yazılmaz: önce yenisi yazılır, başarısızsa eskisi yerinde kalır.
  editExpense: async (old, category, amountCents, paymentMethod, description) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await createExpense(category, amountCents, paymentMethod, description, old.recurringId ?? undefined, old.expenseDate);
    await invokeIPC('void_expense', { expenseId: old.id, reason: 'Düzeltme', actorId, actorRole, tenantId });
    await get().load();
  },

  addRecurring: async (title, category, amountCents, dueDay) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('save_recurring_expense', { title, category, amountCents, dueDay, actorId, actorRole, tenantId });
    await get().load();
  },

  updateRecurring: async (id, title, category, amountCents, dueDay) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('update_recurring_expense', { id, title, category, amountCents, dueDay, actorId, actorRole, tenantId });
    await get().load();
  },

  removeRecurring: async (id) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    await invokeIPC('deactivate_recurring_expense', { id, actorId, actorRole, tenantId });
    await get().load();
  },
}));
