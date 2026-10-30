import { create } from 'zustand';
import type {
  DirectoryContact,
  FinancialProfitSummary,
  PatronActionType,
} from '../types/ledger';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { errorText, localDate, newOperationId } from '../lib/cariInput';

interface LedgerStore {
  directories: DirectoryContact[];
  summary: FinancialProfitSummary | null;
  activeErpTab: 'PANORAMA' | 'REPORTS' | 'EXPENSES' | 'PAYROLL' | 'LEGAL' | 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT' | 'MENU' | 'STOCK' | 'LOG' | 'SETTINGS';
  isLoading: boolean;
  ledgerError: string | null;
  loadLedgerData: () => Promise<void>;
  setActiveErpTab: (tab: 'PANORAMA' | 'REPORTS' | 'EXPENSES' | 'PAYROLL' | 'LEGAL' | 'WIZARD' | 'DEBTS' | 'STAFF' | 'PROFIT' | 'MENU' | 'STOCK' | 'LOG' | 'SETTINGS') => void;
  executePatronAction: (
    actionType: PatronActionType,
    amountCents: number,
    directoryId?: string,
    category?: string,
    description?: string
  ) => Promise<void>;
  createContact: (name: string, phone: string, type: DirectoryContact['type']) => Promise<DirectoryContact>;
}

export const useLedgerStore = create<LedgerStore>((set, get) => ({
  directories: [],
  summary: null,
  activeErpTab: 'PANORAMA',
  isLoading: false,
  ledgerError: null,

  loadLedgerData: async () => {
    try {
      set({ isLoading: true });
      const { actorRole, tenantId } = sessionArgs();
      const [dirs, finSummary] = await Promise.all([
        invokeIPC<DirectoryContact[]>('get_directories', { actorRole, tenantId }),
        invokeIPC<FinancialProfitSummary>('get_financial_report', { actorRole, tenantId }),
      ]);

      set({
        directories: dirs || [],
        summary: finSummary || null,
        ledgerError: null,
      });
    } catch (error) {
      // Eski rapor gösterilmez: okunamayan tutar güncel sanılmasın.
      set({ summary: null, ledgerError: errorText(error) });
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
}));
