import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { invokeIPC } from '../services/tauriClient';
import { useFeatureStore } from './featureStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));

const invokeMock = vi.mocked(invokeIPC);
const initialState = useAuthStore.getState();

describe('oturum sınırı', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    invokeMock.mockReset();
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

  it('kilidi yalnız oturum sahibinin kimliğiyle ister, hatada kilitli kalır', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'usr_1', name: 'Ayşe', role: 'CASHIER', tenant_id: 'ten_2',
      activeModules: [], mustChangePin: false,
    });
    await useAuthStore.getState().loginWithPin('4827');
    useAuthStore.getState().lock();

    invokeMock.mockRejectedValueOnce(new Error('Geçersiz PIN'));
    expect(await useAuthStore.getState().unlock('0000')).toBe(false);
    expect(useAuthStore.getState().isLocked).toBe(true);

    invokeMock.mockResolvedValueOnce(undefined);
    expect(await useAuthStore.getState().unlock('4827')).toBe(true);
    expect(invokeMock).toHaveBeenLastCalledWith('auth_unlock', {
      tenantId: 'ten_2', userId: 'usr_1', pin: '4827',
    });
    expect(useAuthStore.getState()).toMatchObject({ isLocked: false, isAuthenticated: true });
  });

  it('özellik bayraklarını yalnız oturum yanıtından açar ve çıkışta kapatır', async () => {
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
});
