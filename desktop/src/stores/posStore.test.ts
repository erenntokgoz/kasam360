import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTER_TABLE, usePosStore } from './posStore';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import type { Product } from '../types/pos';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));

const invokeMock = vi.mocked(invokeIPC);
const product: Product = {
  id: 'prd_1', categoryId: 'cat_1', name: 'Tost', unitPriceCents: 10000, vatRate: 10, taxRateBp: 1000,
  station: 'MUTFAK', isAvailable: true,
};
const sentItem = {
  id: 'itm_1', product: { id: 'prd_2', name: 'Çay' }, quantity: 2, unitPrice: 1000, taxRate: 1000, total: 2200,
};

function serve(order: { id: string | null; items: unknown[]; remaining: number }) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'get_active_order_id') return order.id as never;
    if (command === 'get_order_items') return order.items as never;
    if (command === 'get_order_balance') {
      return { totalCents: order.remaining, paidCents: 0, remainingCents: order.remaining } as never;
    }
    return 'ord_1' as never;
  });
}

describe('adisyon', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAuthStore.setState({
      user: { userId: 'usr_1', name: 'Ayşe', role: 'CASHIER', tenantId: 'tnt_1', activeModules: [], mustChangePin: false },
    });
    usePosStore.setState({
      activeTableId: null, isWalkin: false, ticketItems: [], drafts: {}, activeOrderId: null, balance: null,
      orderError: null, isSending: false,
    });
  });

  it('masayı sunucudaki adisyon ve bakiyeyle açar, sahte kimlik üretmez', async () => {
    serve({ id: 'ord_gercek', items: [sentItem], remaining: 2200 });
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    const state = usePosStore.getState();
    expect(state.activeOrderId).toBe('ord_gercek');
    expect(state.ticketItems[0]).toMatchObject({ id: 'itm_1', isSentToKitchen: true });
    expect(state.calculateTotalCents()).toBe(2200);
  });

  it('taslak masalar arasında korunur ve bakiyeye eklenir', async () => {
    serve({ id: null, items: [], remaining: 0 });
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    usePosStore.getState().addItemToTicket(product);
    usePosStore.getState().addItemToTicket(product);
    expect(usePosStore.getState().ticketItems).toHaveLength(1);
    expect(usePosStore.getState().calculateTotalCents()).toBe(20000);

    await usePosStore.getState().openOrderForTable('tbl_2', 'Masa 2');
    expect(usePosStore.getState().ticketItems).toHaveLength(0);
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    expect(usePosStore.getState().ticketItems[0].quantity).toBe(2);
  });

  it('mutfağa gönderim gerçek komutu çağırır ve taslağı sunucuyla değiştirir', async () => {
    serve({ id: null, items: [], remaining: 0 });
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    usePosStore.getState().addItemToTicket(product);

    serve({ id: 'ord_1', items: [sentItem], remaining: 2200 });
    expect(await usePosStore.getState().sendToKitchen()).toBe(true);
    const submit = invokeMock.mock.calls.find(([command]) => command === 'submit_order');
    expect(submit?.[1]).toMatchObject({ tenantId: 'tnt_1', actorRole: 'CASHIER' });
    expect(JSON.stringify(submit?.[1])).not.toContain('unitPrice');
    expect(usePosStore.getState().ticketItems.every((i) => i.isSentToKitchen)).toBe(true);
    expect(usePosStore.getState().drafts.tbl_1).toEqual([]);
  });

  it('başarısız gönderimde taslak kaybolmaz ve hata görünür', async () => {
    serve({ id: null, items: [], remaining: 0 });
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    usePosStore.getState().addItemToTicket(product);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'submit_order') throw new Error('PRODUCT_86D');
      return (command === 'get_order_items' ? [] : null) as never;
    });
    expect(await usePosStore.getState().sendToKitchen()).toBe(false);
    expect(usePosStore.getState().ticketItems).toHaveLength(1);
  });

  it('sunucuya gitmiş kalem istemcide değiştirilemez', async () => {
    serve({ id: 'ord_1', items: [sentItem], remaining: 2200 });
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    usePosStore.getState().updateItemQty('itm_1', 1);
    usePosStore.getState().removeItem('itm_1');
    expect(usePosStore.getState().ticketItems[0].quantity).toBe(2);
  });

  it('tezgâh satışı sabit satış noktasını kullanır', async () => {
    serve({ id: null, items: [], remaining: 0 });
    await usePosStore.getState().openWalkinOrder();
    expect(invokeMock).toHaveBeenCalledWith('get_order_items', { tableId: COUNTER_TABLE, tenantId: 'tnt_1' });
  });

  it('okunamayan adisyon boş masa gibi davranmaz, hata gösterir', async () => {
    invokeMock.mockRejectedValue(new Error('disk'));
    await usePosStore.getState().openOrderForTable('tbl_1', 'Masa 1');
    expect(usePosStore.getState().orderError).toContain('disk');
  });
});
