import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { useStationStore } from './stationStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const ipc = vi.mocked(invokeIPC);

describe('akış içinden istasyon oluşturma', () => {
  beforeEach(() => {
    ipc.mockReset();
    useStationStore.setState({ stations: [] });
    useAuthStore.setState({ user: { userId: 'usr_owner', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_test', activeModules: [] }, isAuthenticated: true, isLocked: false, mustChangePin: false });
  });

  it('sunucunun verdiği kimlikle kaydı listeye ekler', async () => {
    ipc.mockResolvedValue('stn_bar');
    const station = await useStationStore.getState().create(' Bar ');
    expect(station).toEqual({ id: 'stn_bar', name: 'Bar', printerName: null, userIds: [] });
    expect(useStationStore.getState().stations).toEqual([station]);
    expect(ipc).toHaveBeenCalledWith('save_station', { actorRole: 'OWNER', tenantId: 'tnt_test', input: { id: null, name: 'Bar', printerName: null, userIds: [] } });
  });

  it('boş ad veya kilitli oturumda yazmaz', async () => {
    await expect(useStationStore.getState().create(' ')).rejects.toThrow();
    useAuthStore.setState({ isLocked: true });
    await expect(useStationStore.getState().create('Bar')).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('sunucu reddederse listeye hayali kayıt eklemez', async () => {
    ipc.mockRejectedValue(new Error('QUORUM_LOST'));
    await expect(useStationStore.getState().create('Bar')).rejects.toThrow('QUORUM_LOST');
    expect(useStationStore.getState().stations).toEqual([]);
  });
});
