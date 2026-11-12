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

export type NoticeKind = 'success' | 'error' | 'warning' | 'info';

export interface Notice {
  id: number;
  message: string;
  kind: NoticeKind;
  /** Aynı bildirim üst üste gelirse yeni kart açılmaz; sayı artar ve süre baştan başlar. */
  count: number;
  /** Geri al gibi tek dokunuşluk eylem; basılınca bildirim kapanır. */
  action?: NoticeAction;
}

export interface NoticeAction {
  label: string;
  run: () => void;
}

interface UIStore {
  notices: Notice[];
  showNotice: (message: string) => void;
  showErrorNotice: (message: string) => void;
  pushNotice: (message: string, kind: NoticeKind) => void;
  /** Geri alınabilir işlem bildirimi: eylem düğmesi taşır ve süre dolana kadar bekler. */
  pushUndoNotice: (message: string, action: NoticeAction) => void;
  clearNotice: (id?: number) => void;
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
  /** Kilitte açık pencereler ve son ekran bırakılır; sonraki personel öncekinin ekranını görmez. */
  resetForLock: () => void;
}

type Theme = 'dark' | 'light';

const CLOSED_MODALS: ModalState = {
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
};

let noticeId = 0;

/** Tekrar eden bildirim yeni kimlik alır: eski kartın zamanlayıcısı yenisini kapatamaz. */
function appendNotice(notices: Notice[], message: string, kind: NoticeKind, action?: NoticeAction): Notice[] {
  const text = message.trim();
  if (!text) return notices;
  const repeated = notices.find((notice) => notice.message === text && notice.kind === kind);
  const distinct = notices.filter((notice) => notice !== repeated);
  return [...distinct.slice(-2), { id: ++noticeId, message: text, kind, count: (repeated?.count ?? 0) + 1, action }];
}

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
  notices: [],
  showNotice: (message) => set((state) => ({ notices: appendNotice(state.notices, message, 'success') })),
  showErrorNotice: (message) => set((state) => ({ notices: appendNotice(state.notices, message, 'error') })),
  pushNotice: (message, kind) => set((state) => ({ notices: appendNotice(state.notices, message, kind) })),
  pushUndoNotice: (message, action) => set((state) => ({ notices: appendNotice(state.notices, message, 'info', action) })),
  clearNotice: (id) => set((state) => ({ notices: id === undefined ? [] : state.notices.filter((notice) => notice.id !== id) })),
  activeModule: 'FLOOR',
  theme: initialTheme,
  idleSecondsLeft: 120,
  idleLimitSeconds: 120, // Varsayılan 2 dakika; 0 kalıcı personel oturumudur.
  modals: { ...CLOSED_MODALS },

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

  resetForLock: () => set({ modals: { ...CLOSED_MODALS }, activeModule: 'FLOOR' }),
}));
