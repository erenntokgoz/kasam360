import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIPC = vi.fn();
const isTauri = vi.fn();
vi.mock('../services/tauriClient', () => ({ invokeIPC, isTauri }));

const { useAuthStore } = await import('./authStore');
const { useShiftStore } = await import('./shiftStore');
const { useUpdateStore } = await import('./updateStore');

const available = { currentVersion: '0.2.0', status: 'AVAILABLE', version: '0.3.0', notes: null, message: null };

describe('updateStore', () => {
  beforeEach(() => {
    invokeIPC.mockReset();
    isTauri.mockReturnValue(true);
    useUpdateStore.setState({ check: null, checking: false, installing: false, message: null, installError: null, dismissedVersion: null });
    useShiftStore.setState({ activeShift: null });
    useAuthStore.setState({ user: { userId: 'usr_1', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_1' } });
  });

  it('açılış denetimi yeni sürüm bulsa da kurulum komutunu çağırmaz', async () => {
    invokeIPC.mockResolvedValue(available);
    await useUpdateStore.getState().checkSilently();
    expect(useUpdateStore.getState().check?.version).toBe('0.3.0');
    expect(invokeIPC.mock.calls.map(([command]) => command)).toEqual(['get_app_update']);
  });

  it('internet yokken açılış denetimi sessiz geçer', async () => {
    invokeIPC.mockRejectedValue('network down');
    await useUpdateStore.getState().checkSilently();
    expect(useUpdateStore.getState().message).toBeNull();
    expect(useUpdateStore.getState().installError).toBeNull();
  });

  it('açık vardiya varken onay verilse bile kurulum komutu gitmez', async () => {
    useUpdateStore.setState({ check: available as never });
    useShiftStore.setState({ activeShift: { id: 'shf_1', isOpen: true } as never });
    await useUpdateStore.getState().install();
    expect(invokeIPC).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().installError).toContain('vardiya');
  });

  it('vardiya yokken onaylı kurulum sürümü ve oturumu backend a iletir', async () => {
    useUpdateStore.setState({ check: available as never });
    invokeIPC.mockResolvedValue(undefined);
    await useUpdateStore.getState().install();
    expect(invokeIPC).toHaveBeenCalledWith('install_app_update', { expectedVersion: '0.3.0', actorRole: 'OWNER', tenantId: 'tnt_1' });
  });

  it('imza veya kurulum hatası açık metinle kalır', async () => {
    useUpdateStore.setState({ check: available as never });
    invokeIPC.mockRejectedValue('UPDATE_INSTALL_FAILED: imza doğrulanamadı');
    await useUpdateStore.getState().install();
    expect(useUpdateStore.getState().installError).toContain('imza doğrulanamadı');
    expect(useUpdateStore.getState().installing).toBe(false);
  });

  it('elle denetim çevrimdışı durumda anlaşılır mesaj verir', async () => {
    invokeIPC.mockResolvedValue({ ...available, status: 'OFFLINE', version: null });
    await useUpdateStore.getState().checkManually();
    expect(useUpdateStore.getState().message).toContain('ulaşılamadı');
  });
});
