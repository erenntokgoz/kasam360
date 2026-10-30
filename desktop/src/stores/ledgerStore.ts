import { create } from 'zustand';
import type {
  DirectoryContact,
  LedgerDebt,
  LedgerExpense,
  FinancialProfitSummary,
  PatronActionType,
  StaffProfile,
} from '../types/ledger';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { errorText, localDate, newOperationId } from '../lib/cariInput';

interface LedgerStore {
  directories: DirectoryContact[];
  debts: LedgerDebt[];
  expenses: LedgerExpense[];
  summary: FinancialProfitSummary | null;
  staffProfiles: StaffProfile[];
  activeErpTab: 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT';
  isLoading: boolean;
  ledgerError: string | null;
  loadLedgerData: () => Promise<void>;
  setActiveErpTab: (tab: 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT') => void;
  executePatronAction: (
    actionType: PatronActionType,
    amountCents: number,
    directoryId?: string,
    category?: string,
    description?: string
  ) => Promise<void>;
  createContact: (name: string, phone: string, type: DirectoryContact['type']) => Promise<DirectoryContact>;
  giveStaffAdvance: (staffId: string, amountCents: number) => Promise<boolean>;
}

export const useLedgerStore = create<LedgerStore>((set, get) => ({
  directories: [],
  debts: [],
  expenses: [],
  summary: null,
  staffProfiles: [
    {
      id: 'stf_01',
      userId: 'usr_waiter',
      name: 'Mehmet Kaya',
      role: 'Garson',
      baseSalaryCents: 2200000, // 22.000,00 TL
      advanceBalanceCents: 350000, // 3.500,00 TL avans
      monthlyCommissionCents: 185000, // 1.850,00 TL prim
      totalSalesCents: 4850000,
      ordersServed: 142,
    },
    {
      id: 'stf_02',
      userId: 'usr_waiter2',
      name: 'Ayşe Sarı',
      role: 'Garson',
      baseSalaryCents: 2200000,
      advanceBalanceCents: 0,
      monthlyCommissionCents: 210000,
      totalSalesCents: 5200000,
      ordersServed: 158,
    },
    {
      id: 'stf_03',
      userId: 'usr_chef',
      name: 'Ali Usta',
      role: 'Mutfak Şefi',
      baseSalaryCents: 3500000, // 35.000,00 TL
      advanceBalanceCents: 500000,
      monthlyCommissionCents: 0,
      totalSalesCents: 0,
      ordersServed: 0,
    },
  ],
  activeErpTab: 'WIZARD',
  isLoading: false,
  ledgerError: null,

  loadLedgerData: async () => {
    try {
      set({ isLoading: true });
      const { actorRole, tenantId } = sessionArgs();
      const [dirs, debtsList, finSummary] = await Promise.all([
        invokeIPC<DirectoryContact[]>('get_directories', { actorRole, tenantId }),
        invokeIPC<LedgerDebt[]>('get_debts', { actorRole, tenantId }),
        invokeIPC<FinancialProfitSummary>('get_financial_report', { actorRole, tenantId }),
      ]);

      set({
        directories: dirs || [],
        debts: debtsList || [],
        summary: finSummary || null,
        ledgerError: null,
      });
    } catch (error) {
      set({ ledgerError: errorText(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  setActiveErpTab: (activeErpTab) => set({ activeErpTab }),

  executePatronAction: async (actionType, amountCents, directoryId, category, description = '') => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    if (actionType === 'BORC' || actionType === 'ALACAK') {
      if (!directoryId) throw new Error('Cari kart seçilmelidir.');
      await invokeIPC('create_debt', {
        actorRole,
        actorId,
        payload: {
          operationId: newOperationId(),
          tenantId,
          directoryId,
          // BORC: bize verilen para, ALACAK: bizim verdiğimiz para.
          type: actionType === 'ALACAK' ? 'GIVEN' : 'TAKEN',
          totalAmountCents: amountCents,
          description: description || undefined,
        },
      });
    } else if (actionType === 'GIDER') {
      await invokeIPC('create_expense', {
        actorRole,
        payload: {
          tenantId,
          category: 'OTHER',
          amountCents,
          paymentMethod: 'CASH',
          directoryId: directoryId || undefined,
          actorId,
          description: [category, description].filter(Boolean).join(': '),
          expenseDate: localDate(new Date()),
        },
      });
    } else {
      throw new Error('Kasa girişi Kasa ekranından yapılır.');
    }
    await get().loadLedgerData();
  },

  createContact: async (name, phone, type) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    const created = await invokeIPC<DirectoryContact>('create_directory', {
      actorRole,
      actorId,
      payload: {
        operationId: newOperationId(),
        tenantId,
        name,
        phone: phone || undefined,
        type,
      },
    });
    set((state) => ({
      directories: [...state.directories, created],
    }));
    return created;
  },

  giveStaffAdvance: async (staffId, amountCents) => {
    set((state) => ({
      staffProfiles: state.staffProfiles.map((s) =>
        s.id === staffId
          ? { ...s, advanceBalanceCents: s.advanceBalanceCents + amountCents }
          : s
      ),
    }));
    return true;
  },
}));
