import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './authStore';
import { useStockStore } from './stockStore';

describe('stok satın alma akışı', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { userId: 'usr_owner', name: 'Sahip', role: 'OWNER',
      tenantId: 'ten_01', activeModules: [] }, isAuthenticated: true,
      isLocked: false, mustChangePin: false });
    useStockStore.setState({ products: [], batches: [], suppliers: [], orders: [], error: null });
  });

  it('tedarikçi, sipariş ve teslimden sonra gerçek parti listeler', async () => {
    const store = useStockStore.getState();
    await store.load();
    const product = useStockStore.getState().products[0];
    expect(product).toBeDefined();
    expect(await store.createSupplier('Demo Tedarikçi')).toBe(true);
    const supplier = useStockStore.getState().suppliers[useStockStore.getState().suppliers.length - 1];
    expect(supplier).toBeDefined();
    expect(await store.createOrder(supplier.id, 'ALIM-TEST', [
      { productId: product.id, quantity: 1.5, unitCostCents: 333 },
    ])).toBe(true);
    const order = useStockStore.getState().orders[0];
    expect(order.totalCents).toBe(500);
    expect(order.status).toBe('TASI');
    expect(await store.receiveOrder(order.id)).toBe(true);
    expect(useStockStore.getState().orders[0].status).toBe('ALINDI');
    expect(useStockStore.getState().batches.some((batch) =>
      batch.productId === product.id && batch.remainingQuantity === 1.5 && batch.unitCostCents === 333
    )).toBe(true);
  });

  it('sahip oturumu olmadan stok verisi açmaz', async () => {
    useAuthStore.getState().logout();
    await useStockStore.getState().load();
    expect(useStockStore.getState().products).toEqual([]);
    expect(useStockStore.getState().error).toContain('sahibi');
  });
});
