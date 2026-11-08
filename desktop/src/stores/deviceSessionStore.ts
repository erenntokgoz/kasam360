import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { sessionArgs } from './cariStore';
import { useSetupStore } from './setupStore';
import { useUIStore } from './uiStore';

interface DeviceSessionReply {
  signedIn: boolean;
  email: string | null;
  accountMissing: boolean;
  keepSignedIn: boolean;
  staffIdleSeconds: number;
}

interface CloudSignOutReply {
  session: DeviceSessionReply;
  wiped: boolean;
  pending: number;
  code: string | null;
}

interface DeviceSessionStore {
  session: DeviceSessionReply | null;
  error: string | null;
  load: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Google girişi biten tek kullanımlık kodla açar; giriş sürüyorsa `false` döner. */
  signInWithLink: (code: string) => Promise<boolean>;
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

    signInWithLink: async (code) => {
      try {
        apply(await invokeIPC<DeviceSessionReply>('account_sign_in_link', { code }));
        return true;
      } catch (caught) {
        if (String(caught).includes('LINK_PENDING')) return false;
        throw caught;
      }
    },

    createAccount: async (email, password, ownerPin) => {
      apply(await invokeIPC<DeviceSessionReply>('account_create', { email, password, ownerPin }));
    },

    // Oturum her durumda kapanır. Yerel veri yalnız bulut her işlemi aldıysa silinir;
    // gitmemiş işlem varsa silme internet gelince arka planda tamamlanır.
    signOut: async () => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      const reply = await invokeIPC<CloudSignOutReply>('cloud_sign_out', { actorId, actorRole, tenantId });
      apply(reply.session);
      useAuthStore.getState().logout();
      if (reply.wiped) {
        await useSetupStore.getState().load();
      } else if (reply.pending > 0) {
        useUIStore.getState().pushNotice(`Buluta gitmemiş ${reply.pending} işlem var; gönderilince bu kasa temizlenir.`, 'warning');
      }
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
