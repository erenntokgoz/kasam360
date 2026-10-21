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
  modals: ModalState;
  setActiveModule: (module: AppModule) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  resetIdleTimer: () => void;
  decrementIdleTimer: () => void;
  openModal: (modalName: keyof ModalState) => void;
  closeModal: (modalName: keyof ModalState) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeModule: 'FLOOR',
  theme: 'dark',
  idleSecondsLeft: 120, // 2 dakika hareketsizlik kuralı
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

  resetIdleTimer: () => set({ idleSecondsLeft: 120 }),

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
