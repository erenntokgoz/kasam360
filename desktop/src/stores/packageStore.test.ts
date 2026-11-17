import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIPC } from '../services/tauriClient';
import { printKitchenTickets } from '../lib/kitchenPrint';
import { useAuthStore } from './authStore';
import { createPackageOrder, settleCourier, usePackageStore } from './packageStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
vi.mock('../lib/kitchenPrint', () => ({ printKitchenTickets: vi.fn() }));
const invokeMock = vi.mocked(invokeIPC);

describe('paket servis deposu', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.mocked(printKitchenTickets).mockReset();
    usePackageStore.setState({ rows: [], couriers: [], loadError: null, actionError: null, isBusy: false });
    useAuthStore.setState({ user: { userId: 'usr_1', tenantId: 'tnt_a', role: 'CASHIER', name: 'Ayşe' } } as never);
  });

  it('tahtayı oturumun kiracısı ve rolüyle okur', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await usePackageStore.getState().load();
    expect(invokeMock).toHaveBeenCalledWith('list_delivery_board', { actorId: 'usr_1', actorRole: 'CASHIER', tenantId: 'tnt_a' });
  });

  it('okuma hatasında eski liste durur ve hata görünür', async () => {
    usePackageStore.setState({ rows: [{ id: 'dlv_1' }] as never });
    invokeMock.mockRejectedValueOnce(new Error('bağlantı yok'));
    await usePackageStore.getState().load();
    expect(usePackageStore.getState().rows).toHaveLength(1);
    expect(usePackageStore.getState().loadError).toBe('bağlantı yok');
  });

  it('durum geçişi hatası kalıcıdır ve liste yenilenir', async () => {
    invokeMock.mockRejectedValueOnce(new Error('CONFLICT: sipariş durumu bu arada değişti')).mockResolvedValueOnce([]);
    const ok = await usePackageStore.getState().advance('dlv_1', 'READY');
    expect(ok).toBe(false);
    expect(usePackageStore.getState().actionError).toContain('sipariş durumu bu arada değişti');
    expect(invokeMock).toHaveBeenLastCalledWith('list_delivery_board', expect.anything());
  });

  it('yola çıkarken kurye sunucuya gider', async () => {
    invokeMock.mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    await usePackageStore.getState().advance('dlv_1', 'ON_ROUTE', 'usr_k');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'advance_delivery', {
      actorId: 'usr_1', actorRole: 'CASHIER', tenantId: 'tnt_a', deliveryId: 'dlv_1', toStatus: 'ON_ROUTE', courierId: 'usr_k',
    });
  });

  it('iptal önce yönetici PIN onayını alır, sonra onay jetonuyla yazar', async () => {
    invokeMock.mockResolvedValueOnce({ approvalToken: 'tok_1' }).mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    await usePackageStore.getState().cancel({ id: 'dlv_1', orderId: 'ord_1', totalCents: 700 } as never, ' vazgeçti ', '1234');
    expect(invokeMock.mock.calls[0][0]).toBe('verify_manager_pin');
    expect(invokeMock.mock.calls[1]).toEqual(['cancel_delivery', expect.objectContaining({ deliveryId: 'dlv_1', reason: 'vazgeçti', approvalToken: 'tok_1' })]);
  });

  it('sipariş kaydedilince kalemler mutfak fişine gider ve tutar istemciden gönderilmez', async () => {
    invokeMock.mockResolvedValueOnce({ deliveryId: 'dlv_1', orderId: 'ord_1', itemIds: ['itm_1'], totalCents: 700 });
    await createPackageOrder({ customerId: 'cus_1', addressId: 'adr_1', items: [], feeCents: 500, paymentMethod: 'CASH', note: '' });
    expect(vi.mocked(printKitchenTickets)).toHaveBeenCalledWith('ord_1', ['itm_1'], 'CASHIER', 'tnt_a');
    expect(JSON.stringify(invokeMock.mock.calls[0][1])).not.toContain('totalCents');
  });

  it('mutabakat seçilen siparişler ve teslim alınan tutarlarla gider', async () => {
    invokeMock.mockResolvedValueOnce({ settlementId: 'crs_1' });
    await settleCourier({ courierId: 'usr_k', deliveryIds: ['dlv_1'], receivedCashCents: 700, receivedCardCents: 0, note: '' });
    expect(invokeMock).toHaveBeenCalledWith('settle_delivery_courier', {
      actorId: 'usr_1', actorRole: 'CASHIER', tenantId: 'tnt_a',
      input: { courierId: 'usr_k', deliveryIds: ['dlv_1'], receivedCashCents: 700, receivedCardCents: 0, note: '' },
    });
  });
});
