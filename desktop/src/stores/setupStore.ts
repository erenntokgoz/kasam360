import { create } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { errorText } from '../lib/cariInput';

export type SetupMode = 'NEW' | 'JOIN';
export type SetupPhase = 'LOADING' | 'PENDING' | 'COMPLETE' | 'ERROR';

export interface SetupDraft {
  businessName: string;
  taxId: string;
  phone: string;
  address: string;
  ownerName: string;
  deviceName: string;
}

interface SetupReply {
  status: 'PENDING' | 'COMPLETE';
  mode: SetupMode | null;
  draft: SetupDraft;
}

interface SetupStore {
  phase: SetupPhase;
  mode: SetupMode | null;
  draft: SetupDraft;
  error: string | null;
  load: () => Promise<void>;
  saveProgress: (mode: SetupMode | null, draft: SetupDraft) => Promise<void>;
  completeNew: (draft: SetupDraft, pin: string, pinConfirm: string) => Promise<void>;
  joinExisting: (code: string, deviceName: string) => Promise<void>;
}

const EMPTY_DRAFT: SetupDraft = {
  businessName: '',
  taxId: '',
  phone: '',
  address: '',
  ownerName: '',
  deviceName: '',
};

export const useSetupStore = create<SetupStore>((set, get) => ({
  phase: 'LOADING',
  mode: null,
  draft: EMPTY_DRAFT,
  error: null,

  // Durum okunamazsa giriş ekranı açılmaz: kurulmamış cihaz kurulmuş sayılamaz.
  load: async () => {
    set({ phase: 'LOADING', error: null });
    try {
      const reply = await invokeIPC<SetupReply>('get_setup_status');
      set({
        phase: reply.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING',
        mode: reply.mode,
        draft: { ...EMPTY_DRAFT, ...reply.draft },
      });
    } catch (caught) {
      set({ phase: 'ERROR', error: errorText(caught) });
    }
  },

  // Taslak kaydı kurulumu durdurmaz; kapanışta yalnız son adım yeniden sorulur.
  saveProgress: async (mode, draft) => {
    set({ mode, draft });
    await invokeIPC('save_setup_draft', { mode, draft });
  },

  completeNew: async (draft, pin, pinConfirm) => {
    await invokeIPC('complete_business_setup', {
      payload: {
        businessName: draft.businessName,
        taxId: draft.taxId,
        phone: draft.phone,
        address: draft.address,
        ownerName: draft.ownerName,
        pin,
        pinConfirm,
      },
    });
    await get().load();
  },

  joinExisting: async (code, deviceName) => {
    await invokeIPC('join_existing_business', { code, deviceName });
    await get().load();
  },
}));
