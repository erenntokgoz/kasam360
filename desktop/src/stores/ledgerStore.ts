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

interface LedgerStore {
  directories: DirectoryContact[];
  debts: LedgerDebt[];
  expenses: LedgerExpense[];
  summary: FinancialProfitSummary | null;
  staffProfiles: StaffProfile[];
  activeErpTab: 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT';
  isLoading: boolean;
  loadLedgerData: () => Promise<void>;
  setActiveErpTab: (tab: 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT') => void;
  executePatronAction: (
    actionType: PatronActionType,
    amountCents: number,
    directoryId?: string,
    category?: string,
    description?: string
  ) => Promise<boolean>;
  createContact: (name: string, phone: string, type: DirectoryContact['type']) => Promise<DirectoryContact>;
  payDebt: (debtId: string, amountCents: number) => Promise<boolean>;
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

  loadLedgerData: async () => {
    try {
      set({ isLoading: true });
      const [dirs, debtsList, finSummary] = await Promise.all([
        invokeIPC<DirectoryContact[]>('get_directories'),
        invokeIPC<LedgerDebt[]>('get_debts'),
        invokeIPC<FinancialProfitSummary>('get_financial_report'),
      ]);

      set({
        directories: dirs || [],
        debts: debtsList || [],
        summary: finSummary || null,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  setActiveErpTab: (activeErpTab) => set({ activeErpTab }),

  executePatronAction: async (actionType, amountCents, directoryId, category, description = '') => {
    try {
      if (actionType === 'BORC' || actionType === 'ALACAK') {
        const isReceivable = actionType === 'ALACAK';
        const targetDir = get().directories.find((d) => d.id === directoryId);
        const newDebt: LedgerDebt = {
          id: `dbt_${Date.now()}`,
          directoryId: directoryId || 'dir_gen',
          directoryName: targetDir?.name || 'Genel Cari',
          debtType: isReceivable ? 'RECEIVABLE' : 'PAYABLE',
          amountCents,
          remainingCents: amountCents,
          description: description || `${actionType === 'BORC' ? 'Para Alındı' : 'Para Verildi'}`,
          createdAt: new Date().toISOString(),
          isPaid: false,
        };

        set((state) => ({
          debts: [newDebt, ...state.debts],
          directories: state.directories.map((d) =>
            d.id === directoryId
              ? {
                  ...d,
                  balanceCents: d.balanceCents + (isReceivable ? amountCents : -amountCents),
                }
              : d
          ),
        }));
      } else if (actionType === 'GIDER') {
        const newExpense: LedgerExpense = {
          id: `exp_${Date.now()}`,
          category: category || 'İşletme Gideri',
          amountCents,
          paymentMethod: 'CASH',
          description,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          expenses: [newExpense, ...state.expenses],
        }));
      }

      await get().loadLedgerData();
      return true;
    } catch {
      return false;
    }
  },

  createContact: async (name, phone, type) => {
    const created = await invokeIPC<DirectoryContact>('create_directory', {
      name,
      phone,
      type,
    });
    set((state) => ({
      directories: [...state.directories, created],
    }));
    return created;
  },

  payDebt: async (debtId, amountCents) => {
    set((state) => ({
      debts: state.debts.map((d) => {
        if (d.id === debtId) {
          const remaining = Math.max(0, d.remainingCents - amountCents);
          return {
            ...d,
            remainingCents: remaining,
            isPaid: remaining === 0,
          };
        }
        return d;
      }),
    }));
    return true;
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
