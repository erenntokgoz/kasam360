import { create } from 'zustand';

export type AppModule = 'FLOOR' | 'POS' | 'KDS' | 'CASHIER' | 'ERP' | 'CATALOG' | 'SETTINGS';

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
  notice: { message: string } | null;
  showNotice: (message: string) => void;
  clearNotice: () => void;
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

type Theme = 'dark' | 'light';

const THEME_KEY = 'kasam360.theme';

/** Tema cihaza özeldir. Depo okunamazsa koyu tema açılır; satışı etkilemez. */
function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Kayıt tutulamazsa seçim yalnız bu açılışta geçerlidir.
  }
}

const initialTheme = loadTheme();
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', initialTheme);

export const useUIStore = create<UIStore>((set, get) => ({
  notice: null,
  showNotice: (message) => set({ notice: { message } }),
  clearNotice: () => set({ notice: null }),
  activeModule: 'FLOOR',
  theme: initialTheme,
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
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
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
