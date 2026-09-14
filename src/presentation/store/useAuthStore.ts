import { create } from 'zustand';
import { SecurityPrincipal, parseActorRole } from '../types/auth';

interface AuthState {
  user: SecurityPrincipal | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  branchId: string;
  branchName: string;
  loginWithCredentials: (email: string, password: string, licenseKey?: string) => Promise<void>;
  login: (pin: string) => Promise<void>;
  lock: () => void;
  unlockWithPin: (pin: string) => Promise<void>;
  logout: () => void;
  setBranch: (branchId: string, branchName?: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLocked: false,
  branchId: '',
  branchName: '',
  loginWithCredentials: async (email: string, password: string, licenseKey?: string) => {
    const { tauriInvoke } = await import('../../data/ipc/tauriInvoke');

    try {
      const result = await tauriInvoke<{
        id: string;
        role: string;
        name: string;
        tenant_id: string;
        branch_id?: string;
        branch_name?: string;
        email?: string;
        license_key?: string;
        token?: string;
      }>('auth_login_credentials', {
        email,
        password,
        identifier: email,
        secret: password,
        license_key: licenseKey || '',
      });

      const branchId = result.branch_id || '';
      const branchName = result.branch_name || '';

      set({ 
        user: { 
          userId: result.id, 
          role: parseActorRole(result.role), 
          name: result.name,
          tenantId: result.tenant_id || '',
          branchId,
          branchName,
        }, 
        branchId,
        branchName,
        isAuthenticated: true,
        isLocked: false,
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      throw new Error(errorMsg);
    }
  },
  login: async (pin: string) => {
    const { tauriInvoke } = await import('../../data/ipc/tauriInvoke');

    try {
      const result = await tauriInvoke<{
        id: string;
        pin: string;
        role: string;
        name: string;
        tenant_id: string;
        branch_id?: string;
        branch_name?: string;
      }>('auth_login', { pin });

      const branchId = result.branch_id || '';
      const branchName = result.branch_name || '';

      set({ 
        user: { 
          userId: result.id, 
          role: parseActorRole(result.role), 
          name: result.name,
          tenantId: result.tenant_id || '',
          branchId,
          branchName,
        }, 
        branchId,
        branchName,
        isAuthenticated: true,
        isLocked: false,
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      throw new Error(errorMsg);
    }
  },
  lock: () => {
    set({ isLocked: true });
  },
  unlockWithPin: async (pin: string) => {
    const { tauriInvoke } = await import('../../data/ipc/tauriInvoke');
    const currentUser = get().user;

    try {
      const result = await tauriInvoke<{
        id: string;
        pin: string;
        role: string;
        name: string;
        tenant_id: string;
        branch_id?: string;
        branch_name?: string;
      }>('auth_login', { pin });

      // İzolasyon denetimi: Eğer terminal bir işletmeye kayıtlıysa,
      // sadece o işletmeye ait personeller veya MASTER admin kilidi açabilir!
      if (currentUser?.tenantId && result.tenant_id && result.role !== 'MASTER' && currentUser.role !== 'MASTER') {
        if (result.tenant_id !== currentUser.tenantId) {
          throw new Error('Yetkisiz Personel: Bu PIN kodu başka bir işletmeye aittir.');
        }
      }

      const branchId = result.branch_id || currentUser?.branchId || '';
      const branchName = result.branch_name || currentUser?.branchName || '';

      set({
        user: {
          userId: result.id,
          role: parseActorRole(result.role),
          name: result.name,
          tenantId: result.tenant_id || currentUser?.tenantId || '',
          branchId,
          branchName,
        },
        branchId,
        branchName,
        isAuthenticated: true,
        isLocked: false,
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      throw new Error(errorMsg);
    }
  },
  logout: () => {
    set({
      user: null,
      isAuthenticated: false,
      isLocked: false,
      branchId: '',
      branchName: '',
    });
  },
  setBranch: (branchId: string, branchName?: string) => {
    set((state) => ({
      branchId,
      branchName: branchName || state.branchName,
      user: state.user
        ? { ...state.user, branchId, branchName: branchName || state.user.branchName }
        : null,
    }));
  },
}));
