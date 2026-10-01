
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { tauriInvoke, resetMockStaff } from '../../src/data/ipc/tauriInvoke';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../../src/presentation/hooks/useAutoLock';

describe('KASAM360 — Terminal Auth, Multi-User PIN & Auto-Lock System', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetMockStaff();
    useAuthStore.getState().logout();
  });

  describe('1. PIN Length Flexibility (Min 4, Max 8 Haneli)', () => {
    it('accepts 4-digit PINs (e.g. 1234, 4444, 8888)', async () => {
      const res = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_cashier',
        new_pin: '7788',
      });
      expect(res.success).toBe(true);
      expect(res.new_pin).toBe('7788');

      // Doğrulama: Yeni 4 haneli PIN ile giriş yapılabilmeli
      const user = await tauriInvoke<any>('auth_login', { pin: '7788' });
      expect(user.id).toBe('usr_cashier');
      expect(user.role).toBe('CASHIER');
    });

    it('accepts 5-digit PINs (e.g. 12345)', async () => {
      const res = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_waiter',
        new_pin: '54321',
      });
      expect(res.success).toBe(true);
      expect(res.new_pin).toBe('54321');

      const user = await tauriInvoke<any>('auth_login', { pin: '54321' });
      expect(user.id).toBe('usr_waiter');
      expect(user.role).toBe('WAITER');
    });

    it('accepts 6-digit PINs (e.g. 123456)', async () => {
      const res = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_manager',
        new_pin: '987654',
      });
      expect(res.success).toBe(true);
      expect(res.new_pin).toBe('987654');

      const user = await tauriInvoke<any>('auth_login', { pin: '987654' });
      expect(user.id).toBe('usr_manager');
      expect(user.role).toBe('MANAGER');
    });

    it('accepts 7-digit PINs (e.g. 1234567)', async () => {
      const res = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_cook',
        new_pin: '1234567',
      });
      expect(res.success).toBe(true);
      expect(res.new_pin).toBe('1234567');

      const user = await tauriInvoke<any>('auth_login', { pin: '1234567' });
      expect(user.id).toBe('usr_cook');
      expect(user.role).toBe('KITCHEN');
    });

    it('accepts 8-digit PINs (e.g. 12345678)', async () => {
      const res = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_owner',
        new_pin: '87654321',
      });
      expect(res.success).toBe(true);
      expect(res.new_pin).toBe('87654321');

      const user = await tauriInvoke<any>('auth_login', { pin: '87654321' });
      expect(user.id).toBe('usr_owner');
      expect(user.role).toBe('OWNER');
    });

    it('rejects PINs shorter than 4 digits (e.g. 3 digits)', async () => {
      await expect(
        tauriInvoke('change_user_pin', {
          callerRole: 'MASTER',
          user_id: 'usr_cashier',
          new_pin: '123',
        })
      ).rejects.toThrow('PIN 4-8 haneli sayısal olmalıdır.');
    });

    it('rejects PINs longer than 8 digits (e.g. 9 digits)', async () => {
      await expect(
        tauriInvoke('change_user_pin', {
          callerRole: 'MASTER',
          user_id: 'usr_cashier',
          new_pin: '123456789',
        })
      ).rejects.toThrow('PIN 4-8 haneli sayısal olmalıdır.');
    });

    it('rejects non-numeric PIN characters', async () => {
      await expect(
        tauriInvoke('change_user_pin', {
          callerRole: 'MASTER',
          user_id: 'usr_cashier',
          new_pin: '12ab',
        })
      ).rejects.toThrow('PIN 4-8 haneli sayısal olmalıdır.');
    });
  });

  describe('2. Common Terminal (Ortak Terminal) Multi-User Switching', () => {
    it('allows different staff members to unlock the locked terminal and updates active operator role', async () => {
      // 1. Müdür oturum açıyor (Seed PIN: 3333)
      await useAuthStore.getState().login('3333');
      expect(useAuthStore.getState().user?.name).toBe('Manager (Müdür)');
      expect(useAuthStore.getState().user?.role).toBe('MANAGER');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isLocked).toBe(false);

      // 2. Ekran kilitleniyor
      useAuthStore.getState().lock();
      expect(useAuthStore.getState().isLocked).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);

      // 3. Garson gelip kendi PIN kodu ile açıyor (Seed PIN: 5555)
      await useAuthStore.getState().unlockWithPin('5555');
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user?.name).toBe('Waiter (Garson)');
      expect(useAuthStore.getState().user?.role).toBe('WAITER');

      // 4. Garson işini bitirip ekranı kilitliyor
      useAuthStore.getState().lock();
      expect(useAuthStore.getState().isLocked).toBe(true);

      // 5. Kasiyer gelip kendi PIN kodu ile açıyor (Seed PIN: 4444)
      await useAuthStore.getState().unlockWithPin('4444');
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user?.name).toBe('Cashier (Kasiyer)');
      expect(useAuthStore.getState().user?.role).toBe('CASHIER');
    });
  });

  describe('3. Self-Service PIN Change via Profile Modal', () => {
    it('allows logged-in staff to update their PIN from profile and immediately authenticate with it', async () => {
      // Kasiyer olarak giriş yap
      await useAuthStore.getState().login('4444');
      expect(useAuthStore.getState().user?.userId).toBe('usr_cashier');

      // Profil modalı üzerinden 6 haneli yeni PIN belirle
      await useAuthStore.getState().changePin('456789');

      // Terminali kilitle
      useAuthStore.getState().lock();
      expect(useAuthStore.getState().isLocked).toBe(true);

      // Yeni 6 haneli PIN ile kilidi aç
      await useAuthStore.getState().unlockWithPin('456789');
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user?.userId).toBe('usr_cashier');
      expect(useAuthStore.getState().user?.role).toBe('CASHIER');
    });

    it('rejects self PIN change if new PIN is shorter than 4 or longer than 8 digits', async () => {
      await useAuthStore.getState().login('4444');
      await expect(useAuthStore.getState().changePin('12')).rejects.toThrow('PIN kodu 4 ila 8 haneli');
      await expect(useAuthStore.getState().changePin('1234567890')).rejects.toThrow('PIN kodu 4 ila 8 haneli');
    });
  });

  describe('4. Hard Logout (Tam Cihaz Çıkışı)', () => {
    it('completely clears user, terminal session, and returns to unauthenticated state', async () => {
      // E-posta ve şifre ile cihaz oturumu aç
      await useAuthStore.getState().loginWithCredentials('admin@kasam360.com', 'admin123');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().terminalSession).not.toBeNull();

      // Tam Çıkış Yap (Hard Logout)
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().terminalSession).toBeNull();
    });
  });

  describe('5. Auto-Lock 2-Minute Inactivity Constant', () => {
    it('verifies default auto lock timeout is strictly 2 minutes (120,000 ms)', () => {
      expect(DEFAULT_AUTO_LOCK_TIMEOUT_MS).toBe(120_000);
    });
  });

  describe('6. Strict Separation: LoginPage (Corporate Credentials) vs LockPage (Terminal PIN Screen)', () => {
    it('initial state or after hard logout is strictly unauthenticated and unlocked (LoginPage route)', () => {
      useAuthStore.getState().logout();
      const state = useAuthStore.getState();
      // İlk kurulum veya çıkış yapılmış cihazda LoginPage görünmelidir
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLocked).toBe(false);
      expect(state.user).toBeNull();
      expect(state.terminalSession).toBeNull();
    });

    it('corporate credentials login sets isAuthenticated to true and terminal is unlocked', async () => {
      await useAuthStore.getState().loginWithCredentials('admin@kasam360.com', 'admin123');
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLocked).toBe(false);
      expect(state.user).not.toBeNull();
      expect(state.terminalSession).not.toBeNull();
    });

    it('locking the active terminal activates LockPage without invalidating authenticated session', async () => {
      await useAuthStore.getState().loginWithCredentials('admin@kasam360.com', 'admin123');
      
      // 2 dk zaman aşımı veya kullanıcı butonu ile kilitle
      useAuthStore.getState().lock();
      const lockedState = useAuthStore.getState();
      expect(lockedState.isAuthenticated).toBe(true);
      expect(lockedState.isLocked).toBe(true);
    });

    it('multi-staff PIN unlock transfers active session seamlessly on common terminal', async () => {
      // 1. Yönetici terminali başlattı
      await useAuthStore.getState().loginWithCredentials('admin@kasam360.com', 'admin123');
      useAuthStore.getState().lock();

      // 2. Garson (5555) kilit ekranında PIN girerek kilidi açar
      await useAuthStore.getState().unlockWithPin('5555');
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user?.role).toBe('WAITER');

      // 3. Garson masadan ayrılırken ekran kilitlenir
      useAuthStore.getState().lock();
      expect(useAuthStore.getState().isLocked).toBe(true);

      // 4. Kasiyer (4444) kilit ekranında PIN girerek kilidi açar
      await useAuthStore.getState().unlockWithPin('4444');
      expect(useAuthStore.getState().isLocked).toBe(false);
      expect(useAuthStore.getState().user?.role).toBe('CASHIER');
    });

    it('hard logout from locked terminal completely clears session and returns to LoginPage', async () => {
      await useAuthStore.getState().loginWithCredentials('admin@kasam360.com', 'admin123');
      useAuthStore.getState().lock();
      expect(useAuthStore.getState().isLocked).toBe(true);

      // Kilit ekranındaki 'Cihaz Oturumunu Kapat' butonuna basılması
      useAuthStore.getState().logout();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLocked).toBe(false);
      expect(state.user).toBeNull();
      expect(state.terminalSession).toBeNull();
    });
  });
});

