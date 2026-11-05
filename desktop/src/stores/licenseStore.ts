import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { invokeIPC } from '../services/tauriClient';
import type { UserRole } from '../types/auth';

export type LicenseState = 'MISSING' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'NO_PACKAGE' | 'BLOCKED' | 'INVALID';

export interface LicenseStatus {
  state: LicenseState;
  linked: boolean;
  email: string | null;
  plan: { name: string; features: string[]; deviceLimit: number } | null;
  validUntil: string | null;
  features: string[];
  checkedAt: string | null;
  lastError: string | null;
}

interface LicenseStore {
  status: LicenseStatus | null;
  error: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  link: (email: string, password: string) => Promise<void>;
  /** Google girişi biten tek kullanımlık kodla bağlar; giriş sürüyorsa `false` döner. */
  linkWithGoogle: (code: string) => Promise<boolean>;
}

/** Kasa yalnız bu iki durumda açılır; tolerans süresinde uyarı gösterilir. */
export const isUsable = (status: LicenseStatus | null) =>
  status?.state === 'ACTIVE' || status?.state === 'GRACE';

/**
 * İşletmenin modül listesi paketle kesişir: lisansta olmayan özellik açılmaz (fail-closed).
 * Platform hesabı işletme lisansına bağlı değildir.
 */
export function licensedModules(modules: string[], role: UserRole, status: LicenseStatus | null): string[] {
  if (role === 'MASTER') return modules;
  if (!isUsable(status)) return [];
  const allowed = new Set(status?.features ?? []);
  return modules.filter((module) => allowed.has(module));
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  status: null,
  error: null,

  // Durum okunamazsa lisans yok sayılır; kapı açık kalmaz.
  load: async () => {
    try {
      set({ status: await invokeIPC<LicenseStatus>('get_license_status'), error: null });
    } catch (caught) {
      set({ status: null, error: errorText(caught) });
    }
  },

  // Ağ hatası eldeki belgeyi silmez; sunucu cevabı durumla birlikte döner.
  refresh: async () => {
    try {
      set({ status: await invokeIPC<LicenseStatus>('refresh_license'), error: null });
    } catch (caught) {
      set({ error: errorText(caught) });
    }
  },

  link: async (email, password) => {
    set({ status: await invokeIPC<LicenseStatus>('link_license', { email, password }), error: null });
  },

  linkWithGoogle: async (code) => {
    try {
      set({ status: await invokeIPC<LicenseStatus>('link_license_with_google', { code }), error: null });
      return true;
    } catch (caught) {
      if (String(caught).includes('LINK_PENDING')) return false;
      throw caught;
    }
  },
}));
