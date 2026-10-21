import { create } from 'zustand';
import type { UserRole, UserSession } from '../types/auth';
import { invokeIPC } from '../services/tauriClient';

interface AuthStore {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  isActivated: boolean;
  mustChangePin: boolean;
  loginError: string | null;
  loginWithPin: (pin: string) => Promise<boolean>;
  loginWithCredentials: (identifier: string, secret: string) => Promise<boolean>;
  activateBranch: (email: string, secret: string, licenseKey: string) => Promise<boolean>;
  changeSelfPin: (currentPin: string, newPin: string) => Promise<boolean>;
  lock: () => void;
  unlock: () => void;
  logout: () => void;
}

const PIN_ROLE_MAP: Record<string, { role: UserRole; name: string; mustChange?: boolean }> = {
  '1111': { role: 'MASTER', name: 'Sistem Yöneticisi', mustChange: true },
  '2222': { role: 'OWNER', name: 'Eren Tokgöz (Patron)' },
  '3333': { role: 'MANAGER', name: 'Ahmet Müdür' },
  '4444': { role: 'CASHIER', name: 'Kasa Personeli' },
  '5555': { role: 'WAITER', name: 'Garson Servis' },
  '6666': { role: 'KITCHEN', name: 'Mutfak Şefi' },
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: {
    userId: 'usr_patron_01',
    name: 'Eren Tokgöz',
    role: 'OWNER',
    tenantId: 'ten_01',
  },
  isAuthenticated: true,
  isLocked: false,
  isActivated: true,
  mustChangePin: false,
  loginError: null,

  loginWithPin: async (pin: string) => {
    try {
      // IPC veya Rol Haritası
      const mapped = PIN_ROLE_MAP[pin];
      if (!mapped) {
        set({ loginError: 'Geçersiz PIN kodu. Lütfen tekrar deneyin.' });
        return false;
      }

      await invokeIPC('auth_login', { pin });

      const session: UserSession = {
        userId: `usr_${mapped.role.toLowerCase()}`,
        name: mapped.name,
        role: mapped.role,
        tenantId: 'ten_01',
        mustChangePin: mapped.mustChange,
      };

      set({
        user: session,
        isAuthenticated: true,
        isLocked: false,
        mustChangePin: !!mapped.mustChange,
        loginError: null,
      });

      return true;
    } catch {
      set({ loginError: 'Giriş yapılamadı. Bağlantı veya PIN hatası.' });
      return false;
    }
  },

  loginWithCredentials: async (identifier: string, secret: string) => {
    try {
      await invokeIPC('auth_login_credentials', { identifier, secret });

      const session: UserSession = {
        userId: 'usr_patron_01',
        name: identifier.split('@')[0] || 'İşletme Sahibi',
        role: 'OWNER',
        tenantId: 'ten_01',
      };

      set({
        user: session,
        isAuthenticated: true,
        isLocked: false,
        mustChangePin: false,
        loginError: null,
      });

      return true;
    } catch {
      set({ loginError: 'Geçersiz hesap bilgileri.' });
      return false;
    }
  },

  activateBranch: async (email: string, secret: string, licenseKey: string) => {
    try {
      await invokeIPC('auth_activate_license', { email, secret, licenseKey });

      const session: UserSession = {
        userId: 'usr_patron_01',
        name: email.split('@')[0] || 'İşletme Sahibi',
        role: 'OWNER',
        tenantId: 'ten_01',
      };

      set({
        user: session,
        isAuthenticated: true,
        isLocked: false,
        isActivated: true,
        mustChangePin: false,
        loginError: null,
      });

      return true;
    } catch {
      set({ loginError: 'Aktivasyon başarısız. Lisans anahtarını kontrol edin.' });
      return false;
    }
  },

  changeSelfPin: async (currentPin: string, newPin: string) => {
    try {
      await invokeIPC('change_self_pin', { currentPin, newPin });
      set({ mustChangePin: false });
      return true;
    } catch {
      return false;
    }
  },

  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
      isLocked: false,
      mustChangePin: false,
      loginError: null,
    }),
}));
