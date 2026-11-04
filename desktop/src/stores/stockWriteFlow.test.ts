import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { useStockStore } from './stockStore';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const ipc = vi.mocked(invokeIPC);
const TERM = { settlement: 'TERM' as const, dueDate: null, documentNo: null, usableGrams: [] };
const order = { id: 'por_test', supplier_id: 'sup_test', order_number: 'ALIM-1', status: 'TASI', total_cents: 100 };

describe('stok yazma sonrası hata sınırları', () => {
  beforeEach(() => {
    ipc.mockReset();
    useAuthStore.setState({ user: { userId: 'usr_owner', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_test', activeModules: [] }, isAuthenticated: true, isLocked: false, mustChangePin: false });
    useStockStore.setState({ products: [], batches: [], orders: [], suppliers: [{ id: 'sup_test', name: 'Tedarikçi' }], busy: false, error: null, pendingQuickReceipt: null, receiptAttempt: null });
    ipc.mockImplementation(async (command) => {
      if (command === 'create_purchase_order_command') return { ...order };
      if (command === 'receive_purchase') return { status: 'APPLIED' };
      if (command === 'get_inventory_suppliers') return [{ id: 'sup_test', name: 'Tedarikçi' }];
      if (command === 'list_purchase_orders_command') return [{ ...order }];
      return [];
    });
  });

  it('liste yenilenemese de sunucunun oluşturduğu sipariş kimliğini korur', async () => {
    ipc.mockImplementation(async (command) => {
      if (command === 'create_purchase_order_command') return { ...order };
      throw new Error('READ_FAILED');
    });
    const created = vi.fn();
    expect(await useStockStore.getState().createOrder('sup_test', 'ALIM-1', [{ productId: 'prd_test', quantity: 1, unitCostCents: 100 }], created)).toBe(true);
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'por_test' }));
    expect(useStockStore.getState().orders[0].id).toBe('por_test');
    expect(useStockStore.getState().error).toContain('kaydedildi');
  });

  it('teslim hatasından sonra aynı siparişi tamamlar, yenisini açmaz', async () => {
    let attempts = 0;
    const normal = ipc.getMockImplementation()!;
    ipc.mockImplementation(async (command, args) => {
      if (command === 'receive_purchase' && ++attempts === 1) throw new Error('QUORUM_LOST');
      return normal(command, args);
    });
    expect(await useStockStore.getState().quickReceive('prd_test', 1, 100, 'sup_test', TERM)).toBe(false);
    expect(useStockStore.getState().pendingQuickReceipt?.orderId).toBe('por_test');
    expect(await useStockStore.getState().quickReceive('prd_test', 1, 100, 'sup_test', TERM)).toBe(true);
    expect(ipc.mock.calls.filter(([command]) => command === 'create_purchase_order_command')).toHaveLength(1);
    expect(useStockStore.getState().pendingQuickReceipt).toBeNull();
    // Sonucu bilinmeyen teslim aynı işlem kimliğiyle yeniden denenir: sunucu ikinci kez yazmaz.
    const receipts = ipc.mock.calls.filter(([command]) => command === 'receive_purchase')
      .map(([, args]) => (args as { payload: { operationId: string; purchaseOrderId: string } }).payload);
    expect(receipts).toHaveLength(2);
    expect(receipts[0].operationId).toBe(receipts[1].operationId);
    expect(receipts[0].purchaseOrderId).toBe('por_test');
  });

  it('seçim değişince yeni işlem kimliği alır', async () => {
    ipc.mockImplementation(async (command) => {
      if (command === 'receive_purchase') throw new Error('VALIDATION: vade geçersiz');
      return [];
    });
    await useStockStore.getState().receiveOrder('por_test', TERM);
    await useStockStore.getState().receiveOrder('por_test', { ...TERM, settlement: 'BANK_TRANSFER' });
    const ids = ipc.mock.calls.map(([, args]) => (args as { payload: { operationId: string; settlement: string } }).payload);
    expect(ids[0].operationId).not.toBe(ids[1].operationId);
    expect(ids[1].settlement).toBe('BANK_TRANSFER');
  });

  it('geçersiz gramı sunucuya göndermez', async () => {
    expect(await useStockStore.getState().receiveOrder('por_test', { ...TERM, usableGrams: [{ productId: 'prd_test', usableGramsPerUnit: 0 }] })).toBe(false);
    expect(ipc).not.toHaveBeenCalled();
  });

  it('bekleyen hızlı giriş varken farklı miktarla yeni sipariş açmaz', async () => {
    useStockStore.setState({ pendingQuickReceipt: { orderId: 'por_test', tenantId: 'tnt_test', productId: 'prd_test', quantity: 1, unitCostCents: 100, supplierId: 'sup_test' } });
    expect(await useStockStore.getState().quickReceive('prd_test', 2, 100, 'sup_test', TERM)).toBe(false);
    expect(ipc).not.toHaveBeenCalled();
  });

  it('aynı ürünü iki satın alma satırında kabul etmez', async () => {
    const line = { productId: 'prd_test', quantity: 1, unitCostCents: 100 };
    expect(await useStockStore.getState().createOrder('sup_test', 'ALIM-1', [line, line])).toBe(false);
    expect(ipc).not.toHaveBeenCalled();
  });
});
