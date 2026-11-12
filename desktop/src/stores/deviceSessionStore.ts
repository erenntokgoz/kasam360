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

/** Çıkış yapıldı ama bulut bütün işlemleri almadığı için yerel veri silinmedi. */
export interface ExitBlock {
  pending: number;
  /** Bulutun son hata kodu; boşsa yalnız bekleniyor. */
  code: string | null;
  message: string | null;
}

interface CloudStatusReply {
  pending: number;
  errorCode: string | null;
  error: string | null;
  wipePending: boolean;
}

interface DeviceSessionStore {
  session: DeviceSessionReply | null;
  /** Kalıcı uyarı: kapatılana ya da kasa temizlenene kadar giriş ekranında durur. */
  exitBlock: ExitBlock | null;
  refreshExitBlock: () => Promise<void>;
  retryExit: () => Promise<void>;
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

  const readExitBlock = async () => {
    const status = await invokeIPC<CloudStatusReply>('get_cloud_sync_status');
    set({
      exitBlock: status.wipePending
        ? { pending: status.pending, code: status.errorCode, message: status.error }
        : null,
    });
  };

  return {
    session: null,
    exitBlock: null,

    // Çıkış yarım kaldıysa uyarı uygulama yeniden açılınca da görünür; durum diskten okunur.
    refreshExitBlock: async () => {
      try {
        await readExitBlock();
      } catch {
        // Durum okunamazsa uyarı eklenmez; veri zaten silinmemiştir.
      }
    },

    retryExit: async () => {
      await invokeIPC('retry_cloud_sync');
      // Arka plan turu birkaç saniyede biter; sonuç durumdan okunur.
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      await readExitBlock();
    },
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
      set({ exitBlock: null });
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
        set({ exitBlock: null });
        await useSetupStore.getState().load();
      } else {
        // Geçici bildirim yerine kalıcı uyarı: kullanıcı başka hesapla girmeden önce nedenini görür.
        try {
          await readExitBlock();
        } catch {
          set({ exitBlock: { pending: reply.pending, code: reply.code, message: null } });
        }
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
