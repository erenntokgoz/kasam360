import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { invokeIPC } from '../services/tauriClient';
import { useFeatureStore } from './featureStore';
import { useLicenseStore, type LicenseStatus } from './licenseStore';
import { useUIStore } from './uiStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));

const invokeMock = vi.mocked(invokeIPC);
const initialState = useAuthStore.getState();

describe('oturum sınırı', () => {
  beforeEach(() => {
  vi.unstubAllEnvs();
    useAuthStore.getState().logout();
    invokeMock.mockReset();
  });

  it('kilitlenince açık pencereler ve son ekran sonraki personele kalmaz', () => {
    invokeMock.mockResolvedValue(undefined);
    useUIStore.getState().setActiveModule('CASHIER');
    useUIStore.getState().openModal('blindClose');
    useUIStore.getState().openModal('payment');
    useAuthStore.getState().lock();
    const ui = useUIStore.getState();
    expect(Object.values(ui.modals).some(Boolean)).toBe(false);
    expect(ui.activeModule).toBe('FLOOR');
  });

  it('uygulama girişsiz açılır', () => {
    expect(initialState.user).toBeNull();
    expect(initialState.isAuthenticated).toBe(false);
  });

  it('PIN rolünü yalnız backend yanıtından alır', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'usr_1', name: 'Ayşe', role: 'WAITER', tenant_id: 'ten_2',
      activeModules: ['feat_table_order'], mustChangePin: false,
    });
    expect(await useAuthStore.getState().loginWithPin('2222')).toBe(true);
    expect(useAuthStore.getState().user).toMatchObject({
      userId: 'usr_1', name: 'Ayşe', role: 'WAITER', tenantId: 'ten_2',
    });
  });

  it('backend reddettiğinde oturum açmaz', async () => {
    invokeMock.mockRejectedValueOnce(new Error('Geçersiz PIN'));
    expect(await useAuthStore.getState().loginWithPin('2222')).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('kilit ekranı girilen PIN sahibine açılır, hatada kilitli kalır', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'usr_1', name: 'Ayşe', role: 'CASHIER', tenant_id: 'ten_2',
      activeModules: [], mustChangePin: false,
    });
    await useAuthStore.getState().loginWithPin('4827');
    useAuthStore.getState().lock();

    invokeMock.mockRejectedValueOnce(new Error('Geçersiz PIN'));
    expect(await useAuthStore.getState().loginWithPin('0000')).toBe(false);
    expect(useAuthStore.getState().isLocked).toBe(true);

    invokeMock.mockResolvedValueOnce({
      id: 'usr_2', name: 'Can', role: 'WAITER', tenant_id: 'ten_2',
      activeModules: [], mustChangePin: false,
    });
    expect(await useAuthStore.getState().loginWithPin('5931')).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({ isLocked: false, isAuthenticated: true });
    expect(useAuthStore.getState().user?.userId).toBe('usr_2');
    // Önceki kullanıcının (kasiyer) yetkisi taşınmaz: oturum yeni personelin rolünü taşır.
    expect(useAuthStore.getState().user?.role).toBe('WAITER');
  });

  it('özellik bayraklarını yalnız oturum yanıtından açar ve çıkışta kapatır', async () => {
    useLicenseStore.setState({ status: license('ACTIVE', ['feat_table_order', 'feat_kds']) });
    invokeMock.mockResolvedValueOnce({
      id: 'usr_1', name: 'Ayşe', role: 'WAITER', tenant_id: 'ten_2',
      activeModules: ['feat_table_order'], mustChangePin: false,
    });
    await useAuthStore.getState().loginWithPin('5555');
    expect(useFeatureStore.getState().isEnabled('feat_table_order')).toBe(true);
    expect(useFeatureStore.getState().isEnabled('feat_kds')).toBe(false);
    useAuthStore.getState().logout();
    expect(useFeatureStore.getState().isEnabled('feat_table_order')).toBe(false);
  });

  it('lisansta olmayan veya süresi geçmiş paketin özelliğini açmaz', async () => {
    vi.stubEnv('VITE_LICENSE_ENFORCED', 'true');
    const login = async () => {
      invokeMock.mockResolvedValueOnce({
        id: 'usr_1', name: 'Ayşe', role: 'OWNER', tenant_id: 'ten_2',
        activeModules: ['feat_table_order', 'feat_kds'], mustChangePin: false,
      });
      await useAuthStore.getState().loginWithPin('5555');
    };
    useLicenseStore.setState({ status: license('ACTIVE', ['feat_kds']) });
    await login();
    expect(useFeatureStore.getState().isEnabled('feat_kds')).toBe(true);
    expect(useFeatureStore.getState().isEnabled('feat_table_order')).toBe(false);
    useAuthStore.getState().logout();
    useLicenseStore.setState({ status: license('EXPIRED', ['feat_kds']) });
    await login();
    expect(useFeatureStore.getState().isEnabled('feat_kds')).toBe(false);
  });
});

function license(state: LicenseStatus['state'], features: string[]): LicenseStatus {
  return {
    state, linked: true, email: 'a@example.test', features,
    plan: { name: 'Temel', features, deviceLimit: 1 }, validUntil: '2027-01-31', checkedAt: null, lastError: null,
  };
}
