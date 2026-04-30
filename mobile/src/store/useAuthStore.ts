import { create } from 'zustand';
import apiClient from '../api/client';
import {
  setItem,
  getItem,
  removeItem,
  clearStorage,
  StorageKeys,
} from '../utils/storage';

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
  isLoading: boolean;
  error: string | null;

  // Actions
  register: (payload: RegisterPayload) => Promise<void>;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  hydrateFromStorage: () => void;
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
  tenant: Tenant;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const persistAuth = (token: string, user: Tenant): void => {
  setItem(StorageKeys.TOKEN, token);
  setItem(StorageKeys.USER, JSON.stringify(user));
};

const clearAuth = (): void => {
  clearStorage();
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state — always start unauthenticated; hydration happens explicitly.
  user: null,
  token: null,
  isLoading: false,
  error: null,

  /**
   * Restores auth state from MMKV on app launch.
   * Call this in the root component (e.g. App.tsx) inside a useEffect.
   */
  hydrateFromStorage: () => {
    const token = getItem(StorageKeys.TOKEN);
    const userRaw = getItem(StorageKeys.USER);

    if (token && userRaw) {
      try {
        const user: Tenant = JSON.parse(userRaw);
        set({ token, user });
      } catch {
        // Corrupted storage — wipe and require re-login
        clearAuth();
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
      persistAuth(data.token, data.tenant);
      set({ user: data.tenant, token: data.token, isLoading: false });
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
  login: async (payload: LoginPayload) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.post<AuthApiResponse>(
        '/api/auth/login',
        payload,
      );
      persistAuth(data.token, data.tenant);
      set({ user: data.tenant, token: data.token, isLoading: false });
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
    set({ user: null, token: null, error: null });
  },

  /** Clears any lingering error message (e.g. when user navigates away). */
  clearError: () => set({ error: null }),
}));
