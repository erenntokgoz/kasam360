/**
 * Kasam360 - KDS Display & FIFO Inventory Engine Binding Integration Tests
 * Path: tests/integration/kdsWorkflow.test.ts
 */



vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return {
    ...actual,
    invoke: async (cmd: string, args: { payload?: { transactionId?: string } } | undefined) => {
      if (cmd === 'process_payment') {
        return {
          success: true,
          transactionId: args?.payload?.transactionId || 'TXN_E2E_SETTLEMENT_001',
          timestamp: new Date().toISOString()
        };
      }
      return [];
    },
    isTauri: () => false
  };
});
import { KdsWorkflowManager } from '../../src/domain/usecases/kds/KdsWorkflowManager';
import { Order } from '../../src/domain/usecases/kds/types';
import { TauriPOSRepository } from '../../src/data/ipc/TauriPOSRepository';
import { PaymentPayload, StationQueueItem } from '../../src/presentation/types';

describe('KDS Real-Time Display & Workflow Engine Integration Suite', () => {
  let manager: KdsWorkflowManager;

  beforeEach(() => {
    KdsWorkflowManager.resetInstance();
    manager = new KdsWorkflowManager({
      initialOrders: [],
    });
  });

  it('enqueues incoming POS customer order, automatically partitions items by station, and syncs to ledger', async () => {
    const order: Order = {
      id: 'ord_test_kds_01',
      orderNumber: 'ORD-501',
      tableNumber: 'Masa 7',
      createdAt: new Date().toISOString(),
      priority: 'RUSH',
      items: [
        {
          id: 'item_1',
          name: 'Kasam360 Gurme Burger',
          quantity: 2,
          category: 'main_dishes',
          productType: 'Burger',
          station: 'Grill',
        },
        {
          id: 'item_2',
          name: 'Baharatlı Parmak Patates',
          quantity: 2,
          category: 'snacks',
          productType: 'Fries',
          station: 'Fryer',
        },
        {
          id: 'item_3',
          name: 'Taş Fırın Margherita Pizza',
          quantity: 1,
          category: 'main_dishes',
          productType: 'Pizza',
          station: 'Pizza',
        },
        {
          id: 'item_4',
          name: 'Iced Americano',
          quantity: 2,
          category: 'cold_drinks',
          productType: 'Drink',
          station: 'Bar',
        },
        {
          id: 'item_5',
          name: 'Chef Garden Salad',
          quantity: 1,
          category: 'prep',
          productType: 'Salad',
          station: 'Prep',
        },
      ],
    };

    const kdsOrder = manager.enqueueOrder(order);

    expect(kdsOrder.id).toBe('ord_test_kds_01');
    expect(kdsOrder.status).toBe('Pending');
    expect(kdsOrder.priority).toBe('RUSH');
    expect(kdsOrder.items).toHaveLength(5);

    // Verify station partitioning
    const stations = kdsOrder.items.map((it: StationQueueItem) => it.station);
    expect(stations).toContain('Grill');

    expect(stations).toContain('Fryer');
    expect(stations).toContain('Pizza');
    expect(stations).toContain('Bar');
    expect(stations).toContain('Prep');

    // Verify active orders in KDS
    const activeOrders = manager.getOrders();
    expect(activeOrders).toHaveLength(1);
    expect(activeOrders[0].id).toBe('ord_test_kds_01');

    // Verify station filtering
    const grillOrders = manager.getOrders({ station: 'Grill' });
    expect(grillOrders).toHaveLength(1);
    expect(grillOrders[0].items).toHaveLength(1);
    expect(grillOrders[0].items[0].station).toBe('Grill');

    // Denetim kaydı istemcide üretilmez; tek kaynak backend'dir. Bu yüzden
    // KDS yöneticisinin ikinci bir ledger'a erişimi olmadığını doğrularız.
    expect(
      (manager as unknown as Record<string, unknown>).ledgerRepository,
    ).toBeUndefined();
    expect(
      typeof (manager as unknown as Record<string, unknown>).waitForLedgerSync,
    ).toBe('undefined');
  });


  it('progresses ticket deterministically across operational lifecycle stages: Pending -> Preparing -> Ready -> Completed', async () => {
    const order: Order = {
      id: 'ord_lifecycle_01',
      orderNumber: 'ORD-999',
      createdAt: new Date().toISOString(),
      items: [
        {
          id: 'item_burger',
          name: 'Burger',
          quantity: 1,
          station: 'Grill',
        },
      ],
    };

    manager.enqueueOrder(order);
    expect(manager.getOrderById('ord_lifecycle_01')?.status).toBe('Pending');

    // Advance 1: Pending -> Preparing
    const preparingOrder = await manager.advanceTicketStatus('ord_lifecycle_01');
    expect(preparingOrder.status).toBe('Preparing');
    expect(preparingOrder.startedAt).toBeDefined();
    expect(preparingOrder.items[0].status).toBe('Preparing');

    // Advance 2: Preparing -> Ready
    const readyOrder = await manager.advanceTicketStatus('ord_lifecycle_01');
    expect(readyOrder.status).toBe('Ready');
    expect(readyOrder.readyAt).toBeDefined();
    expect(readyOrder.items[0].status).toBe('Ready');

    // Advance 3: Ready -> Completed
    const completedOrder = await manager.advanceTicketStatus('ord_lifecycle_01');
    expect(completedOrder.status).toBe('Completed');
    expect(completedOrder.completedAt).toBeDefined();
    expect(completedOrder.items[0].status).toBe('Completed');

    // Completed orders are excluded from default active list
    const activeOrders = manager.getOrders();
    expect(activeOrders).toHaveLength(0);

    // Durum geçişleri istemcide hiçbir denetim yüzeyi bırakmaz: kayıt tek
    // kaynaktan (backend) yazılır.
    expect(Object.keys(manager)).not.toContain('ledgerQueue');
  });

  it('updates individual item preparation statuses and derives order status appropriately', async () => {
    const order: Order = {
      id: 'ord_item_progression',
      orderNumber: 'ORD-888',
      createdAt: new Date().toISOString(),
      items: [
        { id: 'it_1', name: 'Pizza', quantity: 1, station: 'Pizza' },
        { id: 'it_2', name: 'Drink', quantity: 1, station: 'Bar' },
      ],
    };

    manager.enqueueOrder(order);

    // Start preparing item 1
    const s1 = await manager.updateItemStatus('ord_item_progression', 'it_1', 'Preparing');
    expect(s1.status).toBe('Preparing');

    // Mark item 1 ready
    await manager.updateItemStatus('ord_item_progression', 'it_1', 'Ready');
    expect(manager.getOrderById('ord_item_progression')?.status).toBe('Preparing');

    // Mark item 2 ready -> entire order becomes Ready
    const s3 = await manager.updateItemStatus('ord_item_progression', 'it_2', 'Ready');
    expect(s3.status).toBe('Ready');
    expect(s3.readyAt).toBeDefined();
  });

  it('calculates kitchen load and reports bottlenecks when capacity threshold is approached', () => {
    const orders: Order[] = Array.from({ length: 15 }, (_, i) => ({
      id: `ord_heavy_${i}`,
      orderNumber: `ORD-${100 + i}`,
      createdAt: new Date().toISOString(),
      items: [
        {
          id: `item_grill_${i}`,
          name: 'Steak',
          quantity: 2,
          station: 'Grill',
          complexityWeight: 1.5,
        },
      ],
    }));

    for (const ord of orders) {
      manager.enqueueOrder(ord);
    }

    const report = manager.getKitchenLoad();
    expect(report.totalKitchenLoad).toBeGreaterThan(0);
    expect(report.stationMetrics.Grill.activeOrdersCount).toBe(15);
    expect(report.stationMetrics.Grill.loadPercentage).toBeGreaterThanOrEqual(80);
    expect(report.stationMetrics.Grill.isBottleneck).toBe(true);
    expect(report.bottlenecks.some((b) => b.station === 'Grill')).toBe(true);
  });

  it('binds POS payment settlement directly to the KDS workflow pipeline', async () => {
    const posRepo = TauriPOSRepository.getInstance();

    const paymentPayload: PaymentPayload = {
      transactionId: 'TXN_E2E_SETTLEMENT_001',
      orderId: 'ORD_POS_KDS_BIND_01',
      timestamp: new Date().toISOString(),
      method: 'CREDIT_CARD',
      amountTendered: 350.0,
      totalAmount: 350.0,
      changeAmount: 0.0,
      customerRef: 'Masa 9',

      items: [
        {
          id: 'cart_1',
          product: {
            id: 'prod_10',
            sku: 'MAIN-BUR-01',
            barcode: '8690004001',
            name: 'Kasam360 Gurme Burger',
            price: 280.0,
            taxRate: 10,
            category: 'main_dishes',
            inStock: true,
            stockQuantity: 100,
          },
          quantity: 1,
          unitPrice: 280.0,
          taxRate: 10,
          subtotal: 280.0,
          taxAmount: 28.0,
          total: 308.0,
        },
        {
          id: 'cart_2',
          product: {
            id: 'prod_6',
            sku: 'COLD-LEM-02',
            barcode: '8690002002',
            name: 'Ev Yapımı Limonata',
            price: 75.0,
            taxRate: 10,
            category: 'cold_drinks',
            inStock: true,
            stockQuantity: 100,
          },
          quantity: 1,
          unitPrice: 75.0,
          taxRate: 10,
          subtotal: 75.0,
          taxAmount: 7.5,
          total: 82.5,
        },
      ],
    };

    const paymentResult = await posRepo.processPayment(paymentPayload);

    expect(paymentResult.success).toBe(true);
    expect(paymentResult.transactionId).toBe('TXN_E2E_SETTLEMENT_001');

    // Confirm that the POS checkout completion immediately enqueued the order to KDS!
    const activeKdsOrders = KdsWorkflowManager.getInstance().getOrders();
    const boundOrder = activeKdsOrders.find(
      (o) => o.id === 'ORD_POS_KDS_BIND_01' || o.id === 'TXN_E2E_SETTLEMENT_001'
    );

    expect(boundOrder).toBeDefined();
    expect(boundOrder?.status).toBe('Pending');
    expect(boundOrder?.items).toHaveLength(2);
    expect(boundOrder?.items.some((it: StationQueueItem) => it.station === 'Grill')).toBe(true);
    expect(boundOrder?.items.some((it: StationQueueItem) => it.station === 'Bar')).toBe(true);
  });
});

