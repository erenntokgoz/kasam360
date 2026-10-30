import { create } from 'zustand';
import { mapProduct } from '../lib/menuWire';
import { invokeIPC } from '../services/tauriClient';
import type { StockBatch, StockPurchaseOrder, StockState, StockSupplier } from '../types/stock';
import { useAuthStore } from './authStore';

interface BatchWire {
  id: string;
  product_id: string;
  product_name: string;
  stock_unit: string;
  remaining_quantity: number;
  unit_cost_cents: number;
  received_at: string;
  expiry_date: string | null;
}
interface OrderWire {
  id: string;
  supplier_id: string;
  order_number: string;
  status: string;
  total_cents: number;
}

function context() {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || auth.mustChangePin || auth.user?.role !== 'OWNER') {
    throw new Error('Stok yönetimi için işletme sahibi oturumu gerekli.');
  }
  return {
    actorRole: auth.user.role,
    actorId: auth.user.userId,
    tenantId: auth.user.tenantId,
  };
}

function mapBatch(wire: BatchWire): StockBatch {
  if (!wire.id || !wire.product_id || !wire.product_name || !wire.stock_unit ||
      !Number.isFinite(wire.remaining_quantity) || wire.remaining_quantity <= 0 ||
      !Number.isSafeInteger(wire.unit_cost_cents) || wire.unit_cost_cents < 0) {
    throw new Error('Stok partisi yanıtı geçersiz.');
  }
  return {
    id: wire.id, productId: wire.product_id, productName: wire.product_name, stockUnit: wire.stock_unit,
    remainingQuantity: wire.remaining_quantity, unitCostCents: wire.unit_cost_cents,
    receivedAt: wire.received_at, expiryDate: wire.expiry_date,
  };
}

function mapOrder(wire: OrderWire): StockPurchaseOrder {
  if (!wire.id || !wire.supplier_id || !wire.order_number || !wire.status ||
      !Number.isSafeInteger(wire.total_cents) || wire.total_cents < 0) {
    throw new Error('Satın alma yanıtı geçersiz.');
  }
  return {
    id: wire.id, supplierId: wire.supplier_id, orderNumber: wire.order_number,
    status: wire.status, totalCents: wire.total_cents,
  };
}

export const useStockStore = create<StockState>((set, get) => ({
  products: [], batches: [], suppliers: [], orders: [], busy: false, error: null,

  load: async () => {
    try {
      const { actorRole, tenantId } = context();
      set({ busy: true, error: null });
      const [products, batches, suppliers, orders] = await Promise.all([
        invokeIPC<Parameters<typeof mapProduct>[0][]>('get_management_products', { actorRole, tenantId }),
        invokeIPC<BatchWire[]>('list_stock_batches_command', { actorRole, tenantId }),
        invokeIPC<StockSupplier[]>('get_inventory_suppliers', { actorRole, tenantId }),
        invokeIPC<OrderWire[]>('list_purchase_orders_command', { actorRole, tenantId }),
      ]);
      if (!Array.isArray(products) || !Array.isArray(batches) ||
          !Array.isArray(suppliers) || !Array.isArray(orders) ||
          !suppliers.every((supplier) => supplier.id && supplier.name)) {
        throw new Error('Stok verileri okunamadı.');
      }
      set({ products: products.map(mapProduct), batches: batches.map(mapBatch),
        suppliers, orders: orders.map(mapOrder) });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ busy: false });
    }
  },

  createSupplier: async (name) => {
    try {
      const auth = context();
      if (!name.trim()) throw new Error('Tedarikçi adı gerekli.');
      set({ busy: true, error: null });
      await invokeIPC('upsert_supplier_command', {
        ...auth, args: { id: null, name: name.trim() },
      });
      await get().load();
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  createOrder: async (supplierId, orderNumber, items) => {
    try {
      const auth = context();
      if (!supplierId || !orderNumber.trim() || items.length === 0 ||
          items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
            !Number.isSafeInteger(item.unitCostCents) || item.unitCostCents < 0)) {
        throw new Error('Tedarikçi, sipariş no, ürün, miktar ve alış fiyatı gerekli.');
      }
      set({ busy: true, error: null });
      await invokeIPC('create_purchase_order_command', {
        ...auth, args: { supplierId, orderNumber: orderNumber.trim(), expectedAt: null,
          notes: null, items },
      });
      await get().load();
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  receiveOrder: async (orderId) => {
    try {
      const auth = context();
      set({ busy: true, error: null });
      const cost = await invokeIPC<number>('receive_purchase_order_command', {
        ...auth, orderId,
      });
      if (!Number.isSafeInteger(cost) || cost < 0) throw new Error('Teslim maliyeti geçersiz.');
      await get().load();
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  // Tek adımda sipariş ve teslim: stok yine FIFO partisi olarak açılır, ayrı yol yoktur.
  quickReceive: async (productId, quantity, unitCostCents) => {
    let supplier = get().suppliers[0];
    if (!supplier) {
      if (!(await get().createSupplier('Genel Alım'))) return false;
      supplier = get().suppliers[0];
    }
    const orderNumber = `HZL-${Date.now()}`;
    const created = await get().createOrder(supplier.id, orderNumber, [{ productId, quantity, unitCostCents }]);
    const order = get().orders.find((item) => item.orderNumber === orderNumber);
    return created && !!order && get().receiveOrder(order.id);
  },
}));
