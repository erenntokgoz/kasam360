import { create } from 'zustand';
import type { UserRole, UserSession } from '../types/auth';
import { invokeIPC } from '../services/tauriClient';
import { useFeatureStore } from './featureStore';

interface AuthStore {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  mustChangePin: boolean;
  loginError: string | null;
  loginWithPin: (pin: string) => Promise<boolean>;
  loginWithCredentials: (identifier: string, secret: string) => Promise<boolean>;
  changeSelfPin: (currentPin: string, newPin: string) => Promise<boolean>;
  lock: () => void;
  unlock: () => void;
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
      useFeatureStore.getState().setModules(session.activeModules ?? []);
      set({ user: session, isAuthenticated: true, isLocked: false,
        mustChangePin: !!session.mustChangePin, loginError: null });
      return true;
    } catch (error) {
      set({ loginError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  loginWithCredentials: async (identifier, secret) => {
    try {
      const reply = await invokeIPC<AuthReply>('auth_login_credentials', { identifier, secret });
      const session = readSession(reply);
      useFeatureStore.getState().setModules(session.activeModules ?? []);
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

  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
  logout: () => {
    useFeatureStore.getState().setModules([]);
    set({ user: null, isAuthenticated: false, isLocked: false,
      mustChangePin: false, loginError: null });
  },
}));
