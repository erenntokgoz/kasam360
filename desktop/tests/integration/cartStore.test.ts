import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore, calculateItemAmounts } from '../../src/presentation/store/useCartStore';
import { POSProduct } from '../../src/presentation/types';
import { IPOSRepository } from '../../src/domain/repositories/IPOSRepository';
import { TauriPOSRepository } from '../../src/data/ipc/TauriPOSRepository';

const testProduct1: POSProduct = {
  id: 'prod_t1',
  sku: 'TEST-01',
  barcode: '9990001',
  name: 'Test Coffee',
  price: 100.0,
  taxRate: 10,
  category: 'hot_drinks',
  inStock: true,
  stockQuantity: 50,
};

const testProduct2: POSProduct = {
  id: 'prod_t2',
  sku: 'TEST-02',
  barcode: '9990002',
  name: 'Test Croissant',
  price: 50.0,
  taxRate: 1,
  category: 'bakery',
  inStock: true,
  stockQuantity: 20,
};

describe('calculateItemAmounts Helper', () => {
  it('correctly calculates basic line item without discount', () => {
    const res = calculateItemAmounts(10000, 2, 10);
    expect(res.subtotal).toBe(20000);
    expect(res.taxAmount).toBe(2000);
    expect(res.total).toBe(22000);
    expect(res.discountAmount).toBe(0);
  });

  it('correctly applies percentage discount', () => {
    const res = calculateItemAmounts(10000, 2, 10, { type: 'PERCENTAGE', value: 10 });
    // Gross: 20000, 10% discount = 2000 -> Subtotal = 18000, Tax 10% on 18000 = 1800, Total = 19800
    expect(res.subtotal).toBe(18000);
    expect(res.taxAmount).toBe(1800);
    expect(res.total).toBe(19800);
    expect(res.discountAmount).toBe(2000);
  });

  it('correctly applies fixed amount discount capped at gross price', () => {
    const res = calculateItemAmounts(5000, 1, 1, { type: 'FIXED_AMOUNT', value: 1500 });
    // Gross: 5000, fixed 1500 -> Subtotal = 3500, Tax 1% on 3500 = 35, Total = 3535
    expect(res.subtotal).toBe(3500);
    expect(res.taxAmount).toBe(35);
    expect(res.total).toBe(3535);
    expect(res.discountAmount).toBe(1500);
  });
});

describe('useCartStore State Operations', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart();
    useCartStore.getState().setPOSRepository(TauriPOSRepository.getInstance());
  });

  it('adds items to cart and computes totals dynamically', () => {
    const store = useCartStore.getState();
    store.addItem(testProduct1, 2);

    const items = useCartStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].subtotal).toBe(200);
    expect(items[0].total).toBe(220);

    const totals = useCartStore.getState().getTotals();
    expect(totals.itemCount).toBe(2);
    expect(totals.subtotal).toBe(200);
    expect(totals.taxTotal).toBe(20);
    expect(totals.grandTotal).toBe(220);
  });

  it('increments quantity when same product without discount is added again', () => {
    const store = useCartStore.getState();
    store.addItem(testProduct1, 1);
    store.addItem(testProduct1, 2);

    const items = useCartStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0].quantity).toBe(3);

    const totals = useCartStore.getState().getTotals();
    expect(totals.itemCount).toBe(3);
    expect(totals.subtotal).toBe(300);
    expect(totals.taxTotal).toBe(30);
    expect(totals.grandTotal).toBe(330);
  });

  it('updates quantity and removes item when quantity reaches 0', () => {
    const store = useCartStore.getState();
    store.addItem(testProduct2, 2);

    const itemId = useCartStore.getState().items[0].id;
    store.incrementQuantity(itemId);
    expect(useCartStore.getState().items[0].quantity).toBe(3);

    store.decrementQuantity(itemId);
    expect(useCartStore.getState().items[0].quantity).toBe(2);

    store.updateQuantity(itemId, 0);
    expect(useCartStore.getState().items.length).toBe(0);
  });

  it('applies item-level discount and recalculates totals', () => {
    const store = useCartStore.getState();
    store.addItem(testProduct1, 1); // 100 TL, 10% tax = 110 TL

    const itemId = useCartStore.getState().items[0].id;
    store.applyItemDiscount(itemId, { type: 'PERCENTAGE', value: 20 });

    const item = useCartStore.getState().items[0];
    expect(item.subtotal).toBe(80);
    expect(item.taxAmount).toBe(8);
    expect(item.total).toBe(88);

    const totals = useCartStore.getState().getTotals();
    expect(totals.discountTotal).toBe(20);
    expect(totals.grandTotal).toBe(88);
  });

  it('applies global discount on cart totals', () => {
    const store = useCartStore.getState();
    store.addItem(testProduct1, 1); // 110 TL total (100 subtotal + 10 tax)

    store.applyGlobalDiscount({ type: 'PERCENTAGE', value: 10 }); // 10% of 110 = 11 TL

    const totals = useCartStore.getState().getTotals();
    expect(totals.discountTotal).toBe(11);
    expect(totals.grandTotal).toBe(99);
  });

  it('integrates with mock IPOSRepository for payment settlement flow', async () => {
    const store = useCartStore.getState();

    const mockRepo: IPOSRepository = {
      getProducts: async () => [testProduct1],
      getProductById: async (id) => (id === testProduct1.id ? testProduct1 : null),
      getProductByBarcode: async (barcode) => (barcode === '9990001' ? testProduct1 : null),
      getCategories: async () => [{ id: 'hot_drinks', name: 'Sıcak İçecekler' }],
      getProductModifiers: async () => [],
      processPayment: async () => ({
        success: true,
        transactionId: 'dummy',
        fiscalReceiptNo: 'MOCK-FISCAL-1234',
        timestamp: new Date().toISOString(),
        message: 'Payment dummy'
      }),
      processSplitPayment: async () => ({
        success: true,
        transactionId: 'dummy',
        timestamp: new Date().toISOString(),
        message: 'Split dummy'
      }),
      printReceipt: async () => {},
      submitOrder: async () => true,
      voidOrder: async () => true, getOrderItems: async () => [],
    };

    store.setPOSRepository(mockRepo);
    store.addItem(testProduct1, 1);

    const result = await store.processPayment('CASH', 150);

    expect(result.success).toBe(true);
    expect(result.fiscalReceiptNo).toBe('MOCK-FISCAL-1234');
    // Cart should be cleared upon successful settlement
    expect(useCartStore.getState().items.length).toBe(0);
    expect(useCartStore.getState().activeTableId).toBe(null); // Regression test for state contamination
  });

  it('scans barcode via repository and adds product', async () => {
    const store = useCartStore.getState();
    const mockRepo: IPOSRepository = {
      getProducts: async () => [],
      getProductById: async () => null,
      getProductByBarcode: async (barcode: string) => {
        if (barcode === '8690001001') {
          return {
            id: 'espresso_single',
            sku: 'ESP-01',
            barcode: '8690001001',
            name: 'Espresso Single',
            price: 50.0,
            taxRate: 10,
            category: 'hot_drinks',
            inStock: true,
            stockQuantity: 100,
          };
        }
        return null;
      },
      getCategories: async () => [],
      processPayment: async () => ({
        success: true,
        transactionId: '',
        timestamp: new Date().toISOString(),
      }),
      processSplitPayment: async () => ({
        success: true,
        transactionId: '',
        timestamp: new Date().toISOString(),
      }),
      printReceipt: async () => {},
      submitOrder: async () => true,
      voidOrder: async () => true, getOrderItems: async () => [],
    } as unknown as IPOSRepository;
    
    store.setPOSRepository(mockRepo);
    const found = await store.scanBarcode('8690001001');
    expect(found).toBe(true);
    expect(useCartStore.getState().items.length).toBe(1);
    expect(useCartStore.getState().items[0].product.name).toBe('Espresso Single');
  });

  it('calls voidOrder on repository and manages submitting state', async () => {
    const store = useCartStore.getState();
    let voided = false;
    const mockRepo: IPOSRepository = {
      getProducts: async () => [],
      getProductById: async () => null,
      getProductByBarcode: async () => null,
      getCategories: async () => [],
      getProductModifiers: async () => [],
      processPayment: async () => ({
        success: true,
        transactionId: '',
        timestamp: new Date().toISOString(),
      }),
      processSplitPayment: async () => ({
        success: true,
        transactionId: '',
        timestamp: new Date().toISOString(),
      }),
      printReceipt: async () => {},
      submitOrder: async () => true,
      getOrderItems: async () => [], voidOrder: async (payload) => {
        if (payload.orderId === 'ORD_999' && payload.tableId === 'TBL_1') {
          voided = true;
          return true;
        }
        return false;
      },
    };

    store.setPOSRepository(mockRepo);
    await store.voidOrder('TBL_1', 'ORD_999', 'Customer changed mind', 'CASHIER');
    expect(voided).toBe(true);
    expect(useCartStore.getState().isSubmitting).toBe(false);
  });
});
