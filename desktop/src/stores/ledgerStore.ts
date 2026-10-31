import { create } from 'zustand';
import type { DirectoryContact } from '../types/ledger';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { newOperationId } from '../lib/cariInput';

export type ErpTab = 'PANORAMA' | 'FINANCE' | 'DEBTS' | 'STAFF' | 'CATALOG' | 'REPORTS' | 'SETTINGS';

/** Panorama uyarısının hedefi: bölüm ve varsa içindeki alt sayfa. */
const ALERT_TARGETS: Record<string, [ErpTab, string | null]> = {
  EXPENSES: ['FINANCE', null],
  PAYROLL: ['STAFF', 'PAYROLL'],
  STOCK: ['CATALOG', 'STOCK'],
  LOG: ['SETTINGS', 'AUDIT'],
  SETTINGS: ['SETTINGS', 'BACKUP'],
  DEBTS: ['DEBTS', null],
};

interface LedgerStore {
  directories: DirectoryContact[];
  activeErpTab: ErpTab;
  /** Bölüm içindeki alt sayfa; `null` bölümün varsayılanıdır. */
  erpSection: string | null;
  loadDirectories: () => Promise<void>;
  setActiveErpTab: (tab: ErpTab, section?: string | null) => void;
  openAlertTarget: (target: string) => void;
  createContact: (name: string, phone: string, type: DirectoryContact['type']) => Promise<DirectoryContact>;
}

export const useLedgerStore = create<LedgerStore>((set) => ({
  directories: [],
  activeErpTab: 'PANORAMA',
  erpSection: null,

  loadDirectories: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const directories = await invokeIPC<DirectoryContact[]>('get_directories', { actorRole, tenantId });
    set({ directories: directories ?? [] });
  },

  setActiveErpTab: (activeErpTab, erpSection = null) => set({ activeErpTab, erpSection }),

  openAlertTarget: (target) => {
    const destination = ALERT_TARGETS[target];
    if (destination) set({ activeErpTab: destination[0], erpSection: destination[1] });
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
