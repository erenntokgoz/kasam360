import { create } from 'zustand';
import type { DirectoryContact } from '../types/ledger';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { useUIStore } from './uiStore';
import { newOperationId } from '../lib/cariInput';

export type ErpTab = 'PANORAMA' | 'FINANCE' | 'DEBTS' | 'STAFF' | 'CATALOG' | 'BUDGET' | 'TARIFF' | 'REPORTS' | 'AUDIT' | 'ACCOUNTS';

/** Panorama uyarısının hedefi: bölüm ve varsa içindeki alt sayfa. */
const ALERT_TARGETS: Record<string, [ErpTab | 'SETTINGS', string | null]> = {
  EXPENSES: ['FINANCE', null],
  PAYROLL: ['STAFF', 'LEAVE_REQUESTS'],
  STOCK: ['CATALOG', 'STOCK'],
  LOG: ['AUDIT', null],
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
    if (!destination) return;
    const [tab, erpSection] = destination;
    // Ayarlar kendi modülüdür; uyarı oraya geçer, Yönetim sekmesi yerinde kalır.
    if (tab === 'SETTINGS') {
      set({ erpSection });
      useUIStore.getState().setActiveModule('SETTINGS');
    } else {
      // Gider Kasa'da, stok Menü bölümünde yaşar; uyarı kaydın evine götürür.
      set({ activeErpTab: tab === 'CATALOG' ? 'PANORAMA' : tab, erpSection });
      if (tab === 'FINANCE') useUIStore.getState().setActiveModule('CASHIER');
      if (tab === 'CATALOG') useUIStore.getState().setActiveModule('CATALOG');
    }
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
