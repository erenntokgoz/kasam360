import { create } from 'zustand';
import apiClient from '../api/client';
import {
  setItem,
  getItem,
  removeItem,
  StorageKeys,
} from '../utils/storage';
import { useLedgerStore } from './useLedgerStore';
import { useDebtStore } from './useDebtStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  phone: string;
  businessName: string;
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
}

interface AuthState {
  user: Tenant | null;
  token: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  register: (payload: RegisterPayload) => Promise<void>;
  login: (payload: LoginPayload, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  hydrateFromStorage: () => Promise<void>;
  updateProfile: (payload: { businessName?: string; password?: string }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

interface RegisterPayload {
  phone: string;
  password: string;
  businessName: string;
}

interface LoginPayload {
  phone: string;
  password: string;
}

interface AuthApiResponse {
  success: boolean;
  message: string;
  token: string;
  refreshToken: string;
  tenant: Tenant;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const persistAuth = async (token: string, refreshToken: string, user: Tenant): Promise<void> => {
  await Promise.all([
    setItem(StorageKeys.TOKEN, token),
    setItem(StorageKeys.REFRESH_TOKEN, refreshToken),
    setItem(StorageKeys.USER, JSON.stringify(user)),
  ]);
};

const clearAuth = async (): Promise<void> => {
  await removeItem(StorageKeys.TOKEN);
  await removeItem(StorageKeys.REFRESH_TOKEN);
  await removeItem(StorageKeys.USER);
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state — always start unauthenticated; hydration happens explicitly.
  user: null,
  token: null,
  refreshToken: null,
  isLoading: false,
  error: null,

  /**
   * Restores auth state from MMKV on app launch.
   * Call this in the root component (e.g. App.tsx) inside a useEffect.
   */
  hydrateFromStorage: async () => {
    const token = await getItem(StorageKeys.TOKEN);
    const refreshToken = await getItem(StorageKeys.REFRESH_TOKEN);
    const userRaw = await getItem(StorageKeys.USER);

    if (token && userRaw) {
      try {
        const user: Tenant = JSON.parse(userRaw);
        set({ token, refreshToken, user });
      } catch {
        // Corrupted storage — wipe only auth keys
        await clearAuth();
      }
    }
  },

  /**
   * Registers a new tenant and immediately logs them in upon success.
   */
  register: async (payload: RegisterPayload) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.post<AuthApiResponse>(
        '/api/auth/register',
        payload,
      );
      await persistAuth(data.token, data.refreshToken, data.tenant);
      set({ user: data.tenant, token: data.token, refreshToken: data.refreshToken, isLoading: false });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Registration failed.';
      set({ error: message, isLoading: false });
      throw err; // re-throw so UI can react (e.g. show inline error)
    }
  },

  /**
   * Authenticates an existing tenant.
   */
  login: async (payload: LoginPayload, rememberMe?: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.post<AuthApiResponse>(
        '/api/auth/login',
        payload,
      );
      
      if (rememberMe) {
        await setItem(StorageKeys.REMEMBER_ME, 'true');
        await setItem(StorageKeys.PHONE_NUMBER, payload.phone);
      } else {
        await removeItem(StorageKeys.REMEMBER_ME);
        await removeItem(StorageKeys.PHONE_NUMBER);
      }

      await persistAuth(data.token, data.refreshToken, data.tenant);
      set({ user: data.tenant, token: data.token, refreshToken: data.refreshToken, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Clears in-memory auth state and wipes persistent storage.
   */
  logout: () => {
    clearAuth();
    set({ user: null, token: null, refreshToken: null, error: null });
    // Reset data stores so a subsequent login won't briefly show stale data
    useLedgerStore.getState().reset();
    useDebtStore.getState().reset();
  },

  /**
   * Updates current tenant profile details.
   */
  updateProfile: async (payload: { businessName?: string; password?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.patch<AuthApiResponse>(
        '/api/auth/profile',
        payload,
      );
      // Update persistent storage with new user data (token remains same)
      setItem(StorageKeys.USER, JSON.stringify(data.tenant));
      set({ user: data.tenant, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /**
   * Deletes the user account permanently.
   */
  deleteAccount: async () => {
    set({ isLoading: true, error: null });
    try {
      await apiClient.delete('/api/auth/account');
      useAuthStore.getState().logout();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Account deletion failed.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  /** Clears any lingering error message (e.g. when user navigates away). */
  clearError: () => set({ error: null }),
}));
