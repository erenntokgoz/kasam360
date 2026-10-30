import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { sessionArgs } from './cariStore';
import { useUIStore } from './uiStore';

interface DeviceSessionReply {
  signedIn: boolean;
  email: string | null;
  accountMissing: boolean;
  keepSignedIn: boolean;
  staffIdleSeconds: number;
}

interface DeviceSessionStore {
  session: DeviceSessionReply | null;
  error: string | null;
  load: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string, ownerPin: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPolicy: (keepSignedIn: boolean, staffIdleSeconds: number) => Promise<void>;
}

/** Hesap oturumu cihaz içindir: personel kilidi süresi de buradan okunur. */
export const useDeviceSessionStore = create<DeviceSessionStore>((set) => {
  const apply = (session: DeviceSessionReply) => {
    useUIStore.getState().setIdleLimit(session.staffIdleSeconds);
    set({ session, error: null });
  };

  return {
    session: null,
    error: null,

    // Durum okunamazsa cihaz açık sayılmaz; hata ekranda kalır.
    load: async () => {
      try {
        apply(await invokeIPC<DeviceSessionReply>('get_device_session'));
      } catch (caught) {
        set({ session: null, error: errorText(caught) });
      }
    },

    signIn: async (email, password) => {
      apply(await invokeIPC<DeviceSessionReply>('account_sign_in', { email, password }));
    },

    createAccount: async (email, password, ownerPin) => {
      apply(await invokeIPC<DeviceSessionReply>('account_create', { email, password, ownerPin }));
    },

    signOut: async () => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      apply(await invokeIPC<DeviceSessionReply>('account_sign_out', { actorId, actorRole, tenantId }));
      useAuthStore.getState().logout();
    },

    setPolicy: async (keepSignedIn, staffIdleSeconds) => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      apply(
        await invokeIPC<DeviceSessionReply>('set_session_policy', {
          keepSignedIn,
          staffIdleSeconds,
          actorId,
          actorRole,
          tenantId,
        }),
      );
    },
  };
});
