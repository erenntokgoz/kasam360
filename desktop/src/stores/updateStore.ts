import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { BLOCKED_BY_SHIFT, checkResultText, type UpdateCheck } from '../lib/appUpdate';
import { invokeIPC, isTauri } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { useShiftStore } from './shiftStore';

interface UpdateStore {
  currentVersion: string | null;
  check: UpdateCheck | null;
  checking: boolean;
  installing: boolean;
  /** Elle denetim sonucu ve kurulum hatası; açılıştaki sessiz denetim buraya yazmaz. */
  message: string | null;
  installError: string | null;
  dismissedVersion: string | null;
  loadVersion: () => Promise<void>;
  /** Açılış denetimi: ağ yok/hata durumunda sessiz geçer, hiçbir şey kurmaz. */
  checkSilently: () => Promise<void>;
  checkManually: () => Promise<void>;
  /** Yalnız kullanıcı onayıyla çağrılır; indirme, imza doğrulama ve kurulum backend'dedir. */
  install: () => Promise<void>;
  dismiss: () => void;
}

async function fetchCheck(): Promise<UpdateCheck> {
  return invokeIPC<UpdateCheck>('get_app_update');
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  currentVersion: null,
  check: null,
  checking: false,
  installing: false,
  message: null,
  installError: null,
  dismissedVersion: null,

  loadVersion: async () => {
    if (!isTauri()) return;
    try {
      set({ currentVersion: await invokeIPC<string>('get_app_version') });
    } catch {
      set({ currentVersion: null });
    }
  },

  checkSilently: async () => {
    if (!isTauri() || get().checking || get().installing) return;
    set({ checking: true });
    try {
      set({ check: await fetchCheck() });
    } catch {
      // İnternet/IPC hatası satışı etkilemez; sonraki denetimde yeniden denenir.
    } finally {
      set({ checking: false });
    }
  },

  checkManually: async () => {
    if (get().checking || get().installing) return;
    set({ checking: true, message: null, installError: null, dismissedVersion: null });
    try {
      const check = await fetchCheck();
      set({ check, message: checkResultText(check) });
    } catch (error) {
      set({ message: `Güncelleme denetlenemedi: ${errorText(error)}` });
    } finally {
      set({ checking: false });
    }
  },

  install: async () => {
    const { check, installing } = get();
    if (installing || check?.status !== 'AVAILABLE' || !check.version) return;
    // Açık vardiya varken kurulum denenmez bile; backend ayrıca sipariş ve vardiyayı doğrular.
    if (useShiftStore.getState().activeShift?.isOpen) {
      set({ installError: BLOCKED_BY_SHIFT });
      return;
    }
    set({ installing: true, installError: null });
    try {
      const { actorRole, tenantId } = sessionArgs();
      // Başarıda uygulama kapanıp yeniden açılır; buraya dönülürse kurulum olmamıştır.
      await invokeIPC<void>('install_app_update', { expectedVersion: check.version, actorRole, tenantId });
    } catch (error) {
      set({ installError: errorText(error) });
    } finally {
      set({ installing: false });
    }
  },

  dismiss: () => set((state) => ({ dismissedVersion: state.check?.version ?? null })),
}));
