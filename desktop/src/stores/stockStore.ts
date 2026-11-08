import { create } from 'zustand';
import { mapProduct } from '../lib/menuWire';
import { invokeIPC } from '../services/tauriClient';
import type { StockBatch, StockPurchaseOrder, StockState, StockSupplier } from '../types/stock';
import { receiptKey } from '../lib/purchaseReceipt';
import { newOperationId } from '../lib/cariInput';
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
  usable_grams_per_unit?: number | null;
}
interface OrderWire {
  id: string;
  supplier_id: string;
  order_number: string;
  status: string;
  total_cents: number;
  product_ids?: string[];
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
    usableGramsPerUnit: typeof wire.usable_grams_per_unit === 'number' && wire.usable_grams_per_unit > 0
      ? wire.usable_grams_per_unit : null,
  };
}

function mapOrder(wire: OrderWire): StockPurchaseOrder {
  if (!wire.id || !wire.supplier_id || !wire.order_number || !wire.status ||
      !Number.isSafeInteger(wire.total_cents) || wire.total_cents < 0) {
    throw new Error('Satın alma yanıtı geçersiz.');
  }
  return {
    id: wire.id, supplierId: wire.supplier_id, orderNumber: wire.order_number,
    status: wire.status, totalCents: wire.total_cents, productIds: wire.product_ids ?? [],
  };
}

export const useStockStore = create<StockState>((set, get) => ({
  products: [], batches: [], suppliers: [], orders: [], busy: false, error: null, pendingQuickReceipt: null,
  receiptAttempt: null,

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

  createSupplier: async (name, onCreated) => {
    try {
      const auth = context();
      if (!name.trim()) throw new Error('Tedarikçi adı gerekli.');
      set({ busy: true, error: null });
      const supplier = await invokeIPC<StockSupplier>('upsert_supplier_command', {
        ...auth, args: { id: null, name: name.trim() },
      });
      if (!supplier?.id || !supplier.name) throw new Error('Tedarikçi yanıtı geçersiz.');
      set((state) => ({ suppliers: [...state.suppliers.filter((item) => item.id !== supplier.id), supplier] }));
      onCreated?.(supplier);
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  createOrder: async (supplierId, orderNumber, items, onCreated) => {
    if (get().busy) return false;
    try {
      const auth = context();
      if (!supplierId || !orderNumber.trim() || items.length === 0 || new Set(items.map((item) => item.productId)).size !== items.length ||
          items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
            !Number.isSafeInteger(item.unitCostCents) || item.unitCostCents < 0)) {
        throw new Error('Tedarikçi, sipariş no, ürün, miktar ve alış fiyatı gerekli.');
      }
      set({ busy: true, error: null });
      const wire = await invokeIPC<OrderWire>('create_purchase_order_command', {
        ...auth, args: { supplierId, orderNumber: orderNumber.trim(), expectedAt: null,
          notes: null, items },
      });
      const order = mapOrder(wire);
      set((state) => ({ orders: [order, ...state.orders.filter((item) => item.id !== order.id)] }));
      onCreated?.(order);
      await get().load();
      if (get().error) set({ error: `Sipariş kaydedildi; liste yenilenemedi: ${get().error}` });
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  // Parti, stok hareketi ve tedarikçi borcu tek işlemde yazılır; peşinse borç aynı anda kapanır.
  receiveOrder: async (orderId, receipt) => {
    if (get().busy) return false;
    try {
      const { actorRole, actorId, tenantId } = context();
      if (!['TERM', 'CASH', 'CREDIT_CARD', 'BANK_TRANSFER'].includes(receipt.settlement) ||
          receipt.usableGrams.some((line) => !Number.isFinite(line.usableGramsPerUnit) || line.usableGramsPerUnit <= 0)) {
        throw new Error('Ödeme şekli veya gram geçersiz.');
      }
      const key = receiptKey(orderId, receipt);
      const previous = get().receiptAttempt;
      const operationId = previous?.key === key ? previous.operationId : newOperationId();
      set((state) => ({
        busy: true, error: null, receiptAttempt: { key, operationId },
        pendingQuickReceipt: state.pendingQuickReceipt?.orderId === orderId
          ? { ...state.pendingQuickReceipt, receipt }
          : state.pendingQuickReceipt,
      }));
      await invokeIPC('receive_purchase', {
        actorRole,
        payload: {
          operationId, tenantId, actorId, purchaseOrderId: orderId,
          settlement: receipt.settlement, dueDate: receipt.dueDate,
          documentNo: receipt.documentNo, usableGrams: receipt.usableGrams,
        },
      });
      set((state) => ({
        receiptAttempt: null,
        orders: state.orders.map((order) => order.id === orderId ? { ...order, status: 'ALINDI' } : order),
        pendingQuickReceipt: state.pendingQuickReceipt?.orderId === orderId ? null : state.pendingQuickReceipt,
      }));
      await get().load();
      if (get().error) set({ error: `Teslim kaydedildi; liste yenilenemedi: ${get().error}` });
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  // Tek adımda sipariş ve teslim: stok yine FIFO partisi olarak açılır, ayrı yol yoktur.
  quickReceive: async (productId, quantity, unitCostCents, supplierId, receipt) => {
    if (get().busy) return false;
    let tenantId: string;
    try { tenantId = context().tenantId; } catch (caught) { set({ error: String(caught) }); return false; }
    const pending = get().pendingQuickReceipt;
    if (pending) {
      if (pending.tenantId !== tenantId || pending.productId !== productId || pending.quantity !== quantity || pending.unitCostCents !== unitCostCents || pending.supplierId !== supplierId) {
        set({ error: 'Önce bekleyen hızlı girişin teslimini tamamlayın.' });
        return false;
      }
      return get().receiveOrder(pending.orderId, receipt);
    }
    const supplier = get().suppliers.find((item) => item.id === supplierId);
    if (!supplier) { set({ error: 'Tedarikçi seçin veya oluşturun.' }); return false; }
    const orderNumber = `HZL-${crypto.randomUUID()}`;
    const created = await get().createOrder(supplier.id, orderNumber, [{ productId, quantity, unitCostCents }], (order) => {
      set({ pendingQuickReceipt: { orderId: order.id, tenantId, productId, quantity, unitCostCents, supplierId, receipt } });
    });
    const pendingReceipt = get().pendingQuickReceipt;
    return created && !!pendingReceipt && get().receiveOrder(pendingReceipt.orderId, receipt);
  },
}));
