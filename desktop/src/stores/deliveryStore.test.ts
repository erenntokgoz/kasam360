import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { useDeliveryStore, type PendingDelivery } from './deliveryStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const invokeMock = vi.mocked(invokeIPC);

const ready: PendingDelivery = {
  itemId: 'itm_1', orderId: 'ord_1', tableName: 'Masa 4', productName: 'Tost', quantity: 2, readySeconds: 90,
};

describe('teslim listesi deposu', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useDeliveryStore.setState({ items: [], loadError: null, isServing: false });
    useAuthStore.setState({ user: { userId: 'usr_1', tenantId: 'tnt_a', role: 'WAITER', name: 'Ayşe' } } as never);
  });

  it('listeyi oturumun kiracısı ve rolüyle okur', async () => {
    invokeMock.mockResolvedValueOnce([ready]);
    await useDeliveryStore.getState().load();
    expect(invokeMock).toHaveBeenCalledWith('list_pending_deliveries', { tenantId: 'tnt_a', actorRole: 'WAITER' });
    expect(useDeliveryStore.getState().items).toEqual([ready]);
  });

  it('okuma hatasında liste boş sayılmaz, hata kalır', async () => {
    useDeliveryStore.setState({ items: [ready] });
    invokeMock.mockRejectedValueOnce(new Error('bağlantı yok'));
    await useDeliveryStore.getState().load();
    expect(useDeliveryStore.getState().items).toEqual([ready]);
    expect(useDeliveryStore.getState().loadError).toBe('bağlantı yok');
  });

  it('teslim sunucuya yazılır ve liste yeniden okunur', async () => {
    invokeMock.mockResolvedValueOnce(1).mockResolvedValueOnce([]);
    const ok = await useDeliveryStore.getState().serve(['itm_1']);
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'mark_items_served', {
      itemIds: ['itm_1'], tenantId: 'tnt_a', actorId: 'usr_1', actorRole: 'WAITER',
    });
    expect(useDeliveryStore.getState().items).toEqual([]);
  });

  it('başka cihaz önce teslim ettiyse hata gösterilir ve liste yenilenir', async () => {
    invokeMock.mockRejectedValueOnce(new Error('CONFLICT: kalem teslime hazır değil')).mockResolvedValueOnce([]);
    const ok = await useDeliveryStore.getState().serve(['itm_1']);
    expect(ok).toBe(false);
    expect(useDeliveryStore.getState().loadError).toContain('CONFLICT');
  });

  it('boş seçimde sunucuya gitmez', async () => {
    expect(await useDeliveryStore.getState().serve([])).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
