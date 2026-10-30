import { create } from 'zustand';

export type AppModule = 'FLOOR' | 'POS' | 'KDS' | 'CASHIER' | 'ERP';

interface ModalState {
  payment: boolean;
  shiftGate: boolean;
  modifier: boolean;
  itemTransfer: boolean;
  smartAuth: boolean;
  reservation: boolean;
  blindClose: boolean;
  cashIn: boolean;
  cashOut: boolean;
  receiptPreview: boolean;
  patronWizard: boolean;
}

interface UIStore {
  activeModule: AppModule;
  theme: 'dark' | 'light';
  idleSecondsLeft: number;
  idleLimitSeconds: number;
  modals: ModalState;
  setActiveModule: (module: AppModule) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setIdleLimit: (seconds: number) => void;
  resetIdleTimer: () => void;
  decrementIdleTimer: () => void;
  openModal: (modalName: keyof ModalState) => void;
  closeModal: (modalName: keyof ModalState) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  activeModule: 'FLOOR',
  theme: 'dark',
  idleSecondsLeft: 120,
  idleLimitSeconds: 120, // Varsayılan 2 dakika; 0 kalıcı personel oturumudur.
  modals: {
    payment: false,
    shiftGate: false,
    modifier: false,
    itemTransfer: false,
    smartAuth: false,
    reservation: false,
    blindClose: false,
    cashIn: false,
    cashOut: false,
    receiptPreview: false,
    patronWizard: false,
  },

  setActiveModule: (activeModule) => set({ activeModule }),

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      return { theme: nextTheme };
    }),

  setIdleLimit: (seconds) => set({ idleLimitSeconds: seconds, idleSecondsLeft: seconds }),

  resetIdleTimer: () => set({ idleSecondsLeft: get().idleLimitSeconds }),

  decrementIdleTimer: () =>
    set((state) => ({
      idleSecondsLeft: Math.max(0, state.idleSecondsLeft - 1),
    })),

  openModal: (modalName) =>
    set((state) => ({
      modals: { ...state.modals, [modalName]: true },
    })),

  closeModal: (modalName) =>
    set((state) => ({
      modals: { ...state.modals, [modalName]: false },
    })),
}));
