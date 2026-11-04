import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleManagementMockIPC, mockReceiptLog } from '../test/managementIpcFixture';
import { useAuthStore } from './authStore';
import { useStockStore } from './stockStore';

vi.mock('../services/tauriClient', () => ({
  invokeIPC: async (command: string, args: Record<string, unknown> = {}) =>
    handleManagementMockIPC(command, args),
  isTauri: () => false,
}));

const TERM = { settlement: 'TERM' as const, dueDate: null, documentNo: null, usableGrams: [] };

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
    expect(order.productIds).toEqual([product.id]);
    expect(await store.receiveOrder(order.id, {
      settlement: 'CASH', dueDate: null, documentNo: 'FT-1',
      usableGrams: [{ productId: product.id, usableGramsPerUnit: 1200 }],
    })).toBe(true);
    expect(useStockStore.getState().orders[0].status).toBe('ALINDI');
    expect(useStockStore.getState().batches.some((batch) =>
      batch.productId === product.id && batch.remainingQuantity === 1.5 && batch.unitCostCents === 333 &&
      batch.usableGramsPerUnit === 1200
    )).toBe(true);
    expect(mockReceiptLog().find((entry) => entry.orderId === order.id)).toEqual({
      orderId: order.id, settlement: 'CASH', dueDate: null, documentNo: 'FT-1',
    });
    expect(useStockStore.getState().receiptAttempt).toBeNull();
  });

  it('sahip oturumu olmadan stok verisi açmaz', async () => {
    useAuthStore.getState().logout();
    await useStockStore.getState().load();
    expect(useStockStore.getState().products).toEqual([]);
    expect(useStockStore.getState().error).toContain('sahibi');
  });

  it('oluşturulan tedarikçiyi kimliğiyle üst işleme döndürür', async () => {
    const created = vi.fn();
    expect(await useStockStore.getState().createSupplier('Akış Tedarikçisi', created)).toBe(true);
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ name: 'Akış Tedarikçisi', id: expect.any(String) }));
    const selected = created.mock.calls[0][0];
    expect(useStockStore.getState().suppliers.find((supplier) => supplier.id === selected.id)?.name).toBe('Akış Tedarikçisi');
  });

  it('hızlı girişte geçersiz tedarikçiyi başka tedarikçiyle değiştirmez', async () => {
    await useStockStore.getState().load();
    const previous = useStockStore.getState().orders.length;
    const product = useStockStore.getState().products[0];
    expect(await useStockStore.getState().quickReceive(product.id, 1, 100, 'missing', TERM)).toBe(false);
    expect(useStockStore.getState().orders).toHaveLength(previous);
  });
});
