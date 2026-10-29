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

  it('hesap girişinde backend rol ve kiracısını korur', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'usr_3', name: 'Müdür', role: 'MANAGER', tenant_id: 'ten_3',
      activeModules: [], mustChangePin: false,
    });
    expect(await useAuthStore.getState().loginWithCredentials('mudur', 'secret')).toBe(true);
    expect(useAuthStore.getState().user).toMatchObject({ role: 'MANAGER', tenantId: 'ten_3' });
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
