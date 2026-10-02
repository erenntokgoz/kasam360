import { create } from 'zustand';
import { SecurityPrincipal, parseActorRole } from '../types/auth';

// Yerel cihaz terminal oturumu saklama anahtarı (Bir kerelik cihaz oturumu)
const TERMINAL_SESSION_KEY = 'kasam360_terminal_session';

interface TerminalSession {
  tenantId: string;
  branchId: string;
  branchName: string;
}

interface AuthState {
  user: SecurityPrincipal | null;
  terminalSession: TerminalSession | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  branchId: string;
  branchName: string;
  loginWithCredentials: (email: string, password: string, licenseKey?: string) => Promise<void>;
  login: (pin: string) => Promise<void>;
  lock: () => void;
  unlockWithPin: (pin: string) => Promise<void>;
  changePin: (newPin: string, currentPin?: string) => Promise<void>;
  logout: () => void;
  setBranch: (branchId: string, branchName?: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  terminalSession: null,
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
      const tenantId = result.tenant_id || '';

      const terminalSession: TerminalSession = {
        tenantId,
        branchId,
        branchName,
      };

      // Cihaz terminal oturumunu yerel depolamada sakla
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(TERMINAL_SESSION_KEY, JSON.stringify(terminalSession));
        } catch {
          // Kotanın aşılması veya gizli sekme durumunda sessizce devam et
        }
      }

      set({ 
        user: { 
          userId: result.id, 
          role: parseActorRole(result.role), 
          name: result.name,
          tenantId,
          branchId,
          branchName,
          activeModules: (result as unknown as Record<string, unknown>).activeModules as string[] | undefined,
        },
        terminalSession,
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
    const { user: currentUser, terminalSession } = get();
    const currentTenantId = terminalSession?.tenantId || currentUser?.tenantId || '';

    try {
      const result = await tauriInvoke<{
        id: string;
        pin: string;
        role: string;
        name: string;
        tenant_id: string;
        branch_id?: string;
        branch_name?: string;
      }>('auth_login', {
        pin,
        tenant_id: currentTenantId,
        tenantId: currentTenantId,
      });

      const branchId = result.branch_id || '';
      const branchName = result.branch_name || '';

      set({ 
        user: { 
          userId: result.id, 
          role: parseActorRole(result.role), 
          name: result.name,
          tenantId: result.tenant_id || currentTenantId || '',
          branchId,
          branchName,
          activeModules: (result as unknown as Record<string, unknown>).activeModules as string[] | undefined,
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
    const { user: currentUser, terminalSession } = get();
    const currentTenantId = terminalSession?.tenantId || currentUser?.tenantId || '';

    try {
      const result = await tauriInvoke<{
        id: string;
        pin: string;
        role: string;
        name: string;
        tenant_id: string;
        branch_id?: string;
        branch_name?: string;
      }>('auth_login', {
        pin,
        tenant_id: currentTenantId,
        tenantId: currentTenantId,
      });

      // İzolasyon denetimi: Eğer terminal bir işletmeye kayıtlıysa,
      // sadece o işletmeye ait personeller, oturumdaki kullanıcının kendisi veya MASTER admin kilidi açabilir
      const isSameUser = Boolean(currentUser && (currentUser.userId === result.id || currentUser.name === result.name));
      const isMasterUser = result.role === 'MASTER' || currentUser?.role === 'MASTER';
      const isMatchingTenant = !currentTenantId || !result.tenant_id || 
        result.tenant_id === currentTenantId || 
        result.tenant_id === 'DEFAULT_TENANT' || 
        currentTenantId === 'DEFAULT_TENANT';

      if (!isSameUser && !isMasterUser && !isMatchingTenant) {
        throw new Error('Yetkisiz Personel: Bu PIN kodu başka bir işletmeye aittir.');
      }

      const branchId = result.branch_id || terminalSession?.branchId || currentUser?.branchId || '';
      const branchName = result.branch_name || terminalSession?.branchName || currentUser?.branchName || '';

      // Ortak terminal: PIN kodunu giren yeni personelin rolü ve bilgileriyle oturum güncellenir
      set({
        user: {
          userId: result.id,
          role: parseActorRole(result.role),
          name: result.name,
          tenantId: result.tenant_id || currentTenantId || '',
          branchId,
          branchName,
          activeModules: (result as unknown as Record<string, unknown>).activeModules as string[] | undefined,
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

  changePin: async (newPin: string, currentPin?: string) => {
    const currentUser = get().user;
    if (!currentUser) {
      throw new Error('Oturum açmış kullanıcı bulunamadı.');
    }

    if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
      throw new Error('PIN kodu 4 ila 8 haneli rakamlardan oluşmalıdır.');
    }

    const { tauriInvoke } = await import('../../data/ipc/tauriInvoke');
    await tauriInvoke('change_self_pin', {
      user_id: currentUser.userId,
      userId: currentUser.userId,
      current_pin: currentPin || undefined,
      currentPin: currentPin || undefined,
      new_pin: newPin,
      newPin: newPin,
    });
  },

  logout: () => {
    // Tam Çıkış (Hard Logout): Cihaz oturumunu ve aktif kullanıcıyı tamamen temizler
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(TERMINAL_SESSION_KEY);
      } catch {
        // Hata durumunda yoksay
      }
    }

    set({
      user: null,
      terminalSession: null,
      isAuthenticated: false,
      isLocked: false,
      branchId: '',
      branchName: '',
    });
  },

  // Şube geçişi (Faz 6): seçilen şube hem oturumda hem terminal oturumunda
  // yazılır. Önceden yalnızca state'e yazıyordu; sayfa yenilendiğinde geçiş
  // kaybolduğu için üst bardaki rozet eski şubeyi gösteriyordu.
  setBranch: (branchId: string, branchName?: string) => {
    const resolvedName = branchName || '';
    set((state) => {
      const nextSession: TerminalSession | null = state.terminalSession
        ? {
            ...state.terminalSession,
            branchId,
            branchName: resolvedName || state.terminalSession.branchName,
          }
        : null;

      if (nextSession && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(TERMINAL_SESSION_KEY, JSON.stringify(nextSession));
        } catch {
          // Depolama kotası dolu veya özel mod: geçiş yalnızca oturumda tutulur.
        }
      }

      return {
        branchId,
        branchName: resolvedName || state.branchName,
        terminalSession: nextSession,
        user: state.user
          ? {
              ...state.user,
              branchId,
              branchName: resolvedName || state.user.branchName,
            }
          : null,
      };
    });
  },
}));
