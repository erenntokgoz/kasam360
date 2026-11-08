import { create } from 'zustand';
import type { UserRole, UserSession } from '../types/auth';
import { invokeIPC } from '../services/tauriClient';
import { useFeatureStore } from './featureStore';
import { licensedModules, useLicenseStore } from './licenseStore';
import { useUIStore } from './uiStore';

interface AuthStore {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  mustChangePin: boolean;
  loginError: string | null;
  loginWithPin: (pin: string) => Promise<boolean>;
  changeSelfPin: (currentPin: string, newPin: string) => Promise<boolean>;
  lock: () => void;
  logout: () => void;
}

interface AuthReply {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
  activeModules: string[];
  mustChangePin: boolean;
}

const roles: UserRole[] = ['MASTER', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];

function readSession(reply: AuthReply): UserSession {
  if (!reply || !reply.id || !reply.name || !reply.tenant_id ||
      !roles.includes(reply.role as UserRole) || !Array.isArray(reply.activeModules)) {
    throw new Error('Giriş yanıtı geçersiz.');
  }
  return {
    userId: reply.id,
    name: reply.name,
    role: reply.role as UserRole,
    tenantId: reply.tenant_id,
    activeModules: reply.activeModules,
    mustChangePin: reply.mustChangePin,
  };
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLocked: false,
  mustChangePin: false,
  loginError: null,

  loginWithPin: async (pin) => {
    try {
      const reply = await invokeIPC<AuthReply>('auth_login', { pin });
      const session = readSession(reply);
      useFeatureStore.getState().setModules(
        licensedModules(session.activeModules ?? [], session.role, useLicenseStore.getState().status));
      set({ user: session, isAuthenticated: true, isLocked: false,
        mustChangePin: !!session.mustChangePin, loginError: null });
      return true;
    } catch (error) {
      set({ loginError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  changeSelfPin: async (currentPin, newPin) => {
    const userId = get().user?.userId;
    if (!userId) return false;
    try {
      await invokeIPC('change_self_pin', { userId, currentPin, newPin });
      set({ mustChangePin: false });
      return true;
    } catch {
      return false;
    }
  },

  lock: () => {
    // Perdeden önce sunucu kilitlenir; hata olursa perde yine iner.
    void Promise.resolve().then(() => invokeIPC('auth_lock')).catch(() => undefined);
    // Açık tahsilat/vardiya pencereleri ve son ekran perdenin arkasında kalıp sonraki personele geçmesin.
    useUIStore.getState().resetForLock();
    set({ isLocked: true, loginError: null });
  },

  logout: () => {
    // Sunucu oturumu da kapanır; hata arayüz çıkışını engellemez.
    void Promise.resolve().then(() => invokeIPC('auth_logout')).catch(() => undefined);
    useFeatureStore.getState().setModules([]);
    useUIStore.getState().resetForLock();
    set({ user: null, isAuthenticated: false, isLocked: false,
      mustChangePin: false, loginError: null });
  },
}));
