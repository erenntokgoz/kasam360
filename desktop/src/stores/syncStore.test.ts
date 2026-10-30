import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIPC = vi.fn();
const isTauri = vi.fn();
vi.mock('../services/tauriClient', () => ({ invokeIPC, isTauri }));

const { useAuthStore } = await import('./authStore');
const { useSyncStore } = await import('./syncStore');

describe('syncStore', () => {
  beforeEach(() => {
    invokeIPC.mockReset();
    isTauri.mockReturnValue(true);
    useSyncStore.setState({ status: null, statusError: null });
    useAuthStore.setState({
      user: { userId: 'usr_1', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_1' },
    });
  });

  it('durum okunamazsa eski ya da sahte durum kalmaz', async () => {
    useSyncStore.setState({
      status: { mode: 'CLUSTER', state: 'READY', term: 1, commitIndex: 1, members: [] },
    });
    invokeIPC.mockRejectedValue('UNAUTHORIZED: caller_role is required');
    await useSyncStore.getState().refresh();
    expect(useSyncStore.getState().status).toBeNull();
    expect(useSyncStore.getState().statusError).toContain('UNAUTHORIZED');
  });

  it('tarayıcı önizlemesinde komut çağırmaz', async () => {
    isTauri.mockReturnValue(false);
    await useSyncStore.getState().refresh();
    expect(invokeIPC).not.toHaveBeenCalled();
    expect(useSyncStore.getState().status).toBeNull();
  });

  it('pasife alma kimliği ve kiracıyla gider, durum yenilenir', async () => {
    invokeIPC.mockResolvedValue({ mode: 'SINGLE', state: 'READY', term: 0, commitIndex: 0, members: [] });
    await useSyncStore.getState().setDevicePassive('dev_2');
    expect(invokeIPC).toHaveBeenCalledWith('set_device_passive', {
      actorRole: 'OWNER',
      actorId: 'usr_1',
      tenantId: 'tnt_1',
      deviceId: 'dev_2',
    });
    expect(useSyncStore.getState().status?.mode).toBe('SINGLE');
  });
});
