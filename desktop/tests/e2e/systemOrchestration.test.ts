/**
 * Kasam360 - Full-Stack End-to-End System Orchestration Test Suite
 * Path: tests/e2e/systemOrchestration.test.ts
 *
 * Operational Workflow Validation:
 * Order generation -> KDS Station Routing -> Inventory FIFO Deduction -> Immutable Ledger Hashing -> RBAC Protection
 */


import { StationRouter } from '../../src/domain/usecases/kds/StationRouter';
import { Order, OrderItem } from '../../src/domain/usecases/kds/types';
import { FifoCostCalculator } from '../../src/domain/usecases/inventory/FifoCostCalculator';
import { InventoryBatch } from '../../src/domain/usecases/inventory/types';
import { KdsWorkflowManager as ManagerSurface } from '../../src/domain/usecases/kds/KdsWorkflowManager';
import { buildAuditCsv } from '../../src/core/audit/auditCatalog';
import { hasCapability } from '../../src/core/security/navigationMatrix';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import {
  AuthorizationGuard,
  DataBoundaryViolationError,
} from '../../src/domain/usecases/auth/AuthorizationGuard';
import { Role } from '../../src/core/security/roles.types';
import {
  BackgroundSyncWorker,
  RealtimeNetworkListener,
} from '../../src/data/sync/BackgroundSyncWorker';
import {
  ISyncHttpClient,
  SyncPayload,
  SyncPushResponse,
} from '../../src/data/sync/types';
import {
  INITIAL_INVENTORY_BATCHES,
  MOCK_CHEESEBURGER_RECIPE_VERSION,
  MOCK_CRISPY_FRIES_RECIPE_VERSION,
  MOCK_MARGHERITA_RECIPE_VERSION,
} from '../fixtures/eventStream.fixture';

// =========================================================================
// Test Doubles
// =========================================================================

class E2EMockHttpClient implements ISyncHttpClient {
  public pushedBatches: SyncPayload[] = [];

  public async postSyncPush(_url: string, payload: SyncPayload): Promise<SyncPushResponse> {
    this.pushedBatches.push(JSON.parse(JSON.stringify(payload)));
    return {
      success: true,
      processedRecordIds: payload.records.map((r) => r.id),
      serverVectorClock: {
        ...payload.vectorClock,
        'cloud-sync': 1,
      },
      message: 'Batch synchronized successfully',
    };
  }
}

describe('Full-Stack System Orchestration E2E Test Suite', () => {
  const getFreshBatches = (): InventoryBatch[] =>
    JSON.parse(JSON.stringify(INITIAL_INVENTORY_BATCHES));

  // =========================================================================
  // Complete End-to-End Lifecycle Workflow
  // =========================================================================
  it('executes the full lifecycle: Order Generation -> KDS Routing -> FIFO Deduction -> Immutable Ledger -> RBAC -> Sync', async () => {
    // -----------------------------------------------------------------------
    // STEP 1: ORDER GENERATION (POS Front-of-House)
    // -----------------------------------------------------------------------
    const orderId = `ord_e2e_${Date.now()}`;
    const orderItems: OrderItem[] = [
      {
        id: 'item_burger_01',
        name: 'Classic Cheeseburger',
        quantity: 2,
        category: 'Burgers',
        productType: 'Burger',
      },
      {
        id: 'item_fries_01',
        name: 'Crispy French Fries',
        quantity: 2,
        category: 'Sides',
        productType: 'Fries',
      },
      {
        id: 'item_pizza_01',
        name: 'Margherita Pizza',
        quantity: 1,
        category: 'Pizzas',
        productType: 'Pizza',
      },
      {
        id: 'item_beer_01',
        name: 'Craft IPA Beer',
        quantity: 2,
        category: 'Beverages',
        productType: 'Beer',
      },
      {
        id: 'item_salad_01',
        name: 'Chef Garden Salad',
        quantity: 1,
        category: 'Appetizers',
        productType: 'Salad',
      },
    ];

    const customerOrder: Order = {
      id: orderId,
      orderNumber: 'ORD-777',
      tableNumber: 'Table 12',
      items: orderItems,
      createdAt: new Date().toISOString(),
      priority: 'NORMAL',
    };

    expect(customerOrder.items).toHaveLength(5);

    // -----------------------------------------------------------------------
    // STEP 2: KDS STATION ROUTING
    // -----------------------------------------------------------------------
    const routedStationMap = StationRouter.route(customerOrder);

    // Assert accurate partitioning across kitchen stations
    expect(routedStationMap.Grill).toHaveLength(1);
    expect(routedStationMap.Grill[0].name).toBe('Classic Cheeseburger');
    expect(routedStationMap.Grill[0].station).toBe('Grill');

    expect(routedStationMap.Fryer).toHaveLength(1);
    expect(routedStationMap.Fryer[0].name).toBe('Crispy French Fries');
    expect(routedStationMap.Fryer[0].station).toBe('Fryer');

    expect(routedStationMap.Pizza).toHaveLength(1);
    expect(routedStationMap.Pizza[0].name).toBe('Margherita Pizza');
    expect(routedStationMap.Pizza[0].station).toBe('Pizza');

    expect(routedStationMap.Bar).toHaveLength(1);
    expect(routedStationMap.Bar[0].name).toBe('Craft IPA Beer');
    expect(routedStationMap.Bar[0].station).toBe('Bar');

    expect(routedStationMap.Prep).toHaveLength(1);
    expect(routedStationMap.Prep[0].name).toBe('Chef Garden Salad');
    expect(routedStationMap.Prep[0].station).toBe('Prep');

    // -----------------------------------------------------------------------
    // STEP 3: INVENTORY FIFO DEDUCTION & COGS DETERMINATION
    // -----------------------------------------------------------------------
    let currentInventory = getFreshBatches();
    const initialValuation = FifoCostCalculator.calculateInventoryValuation(currentInventory);

    // 1. Consume 2 Cheeseburgers
    const burgerConsumption = FifoCostCalculator.consumeRecipe(
      currentInventory,
      MOCK_CHEESEBURGER_RECIPE_VERSION,
      2,
      customerOrder.id
    );
    currentInventory = burgerConsumption.updatedBatches;

    // Expected Burger COGS: (2 * 2.50 patty) + (2 * 0.50 bun) + (2 * 0.80 cheese) = 5.0 + 1.0 + 1.6 = 7.6
    expect(burgerConsumption.totalCogs).toBe(7.6);
    expect(burgerConsumption.movements).toHaveLength(3);

    // Assert Beef Patty Batch 1 was deducted from 10 to 8
    const beefBatch1 = currentInventory.find((b) => b.id === 'batch_beef_001');
    expect(beefBatch1?.remainingQuantity).toBe(8);

    // 2. Consume 2 Portions of Crispy Fries
    const friesConsumption = FifoCostCalculator.consumeRecipe(
      currentInventory,
      MOCK_CRISPY_FRIES_RECIPE_VERSION,
      2,
      customerOrder.id
    );
    currentInventory = friesConsumption.updatedBatches;

    // Expected Fries COGS: 2 * 0.40 = 0.80
    expect(friesConsumption.totalCogs).toBe(0.8);
    const friesBatch1 = currentInventory.find((b) => b.id === 'batch_fries_001');
    expect(friesBatch1?.remainingQuantity).toBe(38); // 40 - 2 = 38

    // 3. Consume 1 Margherita Pizza
    const pizzaConsumption = FifoCostCalculator.consumeRecipe(
      currentInventory,
      MOCK_MARGHERITA_RECIPE_VERSION,
      1,
      customerOrder.id
    );
    currentInventory = pizzaConsumption.updatedBatches;

    // Expected Pizza COGS: (1 * 1.20 dough) + (1 * 1.50 mozz) + (1 * 0.70 sauce) = 3.40
    expect(pizzaConsumption.totalCogs).toBe(3.4);

    const totalOrderCogs =
      Math.round(
        (burgerConsumption.totalCogs + friesConsumption.totalCogs + pizzaConsumption.totalCogs) *
          10000
      ) / 10000;
    expect(totalOrderCogs).toBe(11.8);

    // Validate financial conservation: Initial Valuation === Current Valuation + Total COGS
    const postConsumptionValuation =
      FifoCostCalculator.calculateInventoryValuation(currentInventory);
    expect(
      Math.round((postConsumptionValuation.totalValuation + totalOrderCogs) * 10000) / 10000
    ).toBe(initialValuation.totalValuation);

    // -----------------------------------------------------------------------
    // STEP 4: TEK DENETİM KAYNAĞI (istemcide zincir yok)
    // -----------------------------------------------------------------------
    // Denetim defteri ve SHA-256 zinciri yalnızca backend'de kurulur. Uçtan uca
    // akışın istemci tarafındaki sözleşmesi şudur: kayıtlar mühürlü gelir, ham
    // hash hiçbir katmanda bulunmaz. Aşağıdaki kontrol, ikinci bir zincirin
    // yeniden doğmamasını güvenceye alır.
    ManagerSurface.resetInstance();
    const managerSurface = new ManagerSurface({ initialOrders: [] });
    const clientSurface = {
      ledgerRepository: (
        managerSurface as unknown as Record<string, unknown>
      ).ledgerRepository,
      waitForLedgerSync: (
        managerSurface as unknown as Record<string, unknown>
      ).waitForLedgerSync,
    };
    expect(clientSurface.ledgerRepository).toBeUndefined();
    expect(clientSurface.waitForLedgerSync).toBeUndefined();

    const platformLogs = await tauriInvoke<Array<Record<string, unknown>>>(
      'get_platform_audit_logs',
      { callerRole: 'MASTER' }
    );
    for (const row of platformLogs) {
      expect(row).not.toHaveProperty('hash');
      expect(row).not.toHaveProperty('current_hash');
      expect(row).not.toHaveProperty('previous_hash');
    }

    const verification = await tauriInvoke<Record<string, unknown>>(
      'verify_audit_ledger_integrity',
      { callerRole: 'MASTER' }
    );
    expect(verification.isValid).toBe(true);
    expect(verification).not.toHaveProperty('rootHash');
    expect(verification).not.toHaveProperty('root_hash');

    // -----------------------------------------------------------------------
    // STEP 5: RBAC PERMISSION ENFORCEMENT & BOUNDARY SEGREGATION
    // -----------------------------------------------------------------------
    const authGuard = new AuthorizationGuard();

    const waiterRole: Role = 'WAITER';
    const kitchenRole: Role = 'KITCHEN';
    const ownerRole: Role = 'OWNER';
    const managerRole: Role = 'MANAGER';

    // Waiter & Kitchen can access their designated domain areas
    expect(authGuard.can(waiterRole, 'order:create')).toBe(true);
    expect(authGuard.can(kitchenRole, 'kds:view')).toBe(true);
    expect(authGuard.can(ownerRole, 'financial:report:view')).toBe(true);
    expect(authGuard.can(managerRole, 'screen:inventory')).toBe(true);

    // Waiter & Kitchen are strictly forbidden from financial reports & cost settings
    expect(() => {
      authGuard.assertPermission(waiterRole, 'financial:report:view');
    }).toThrow(DataBoundaryViolationError);

    expect(() => {
      authGuard.assertPermission(kitchenRole, 'financial:cost_settings:view');
    }).toThrow(DataBoundaryViolationError);

    // Denetim okuma sınırı: yalnızca işletme sahibi ve müdür defteri okur.
    expect(hasCapability('OWNER', 'auditRead')).toBe(true);
    expect(hasCapability('MANAGER', 'auditRead')).toBe(true);
    expect(hasCapability('WAITER', 'auditRead')).toBe(false);
    expect(hasCapability('KITCHEN', 'auditRead')).toBe(false);

    // MASTER platform ekranını kullanır, işletme defterini göremez.
    await expect(
      tauriInvoke('get_audit_logs', { callerRole: 'MASTER' })
    ).rejects.toThrow(/UNAUTHORIZED/);

    // -----------------------------------------------------------------------
    // STEP 6: RESILIENT OUTBOX QUEUE SYNCHRONIZATION
    // -----------------------------------------------------------------------
    const networkListener = new RealtimeNetworkListener();
    const mockHttpClient = new E2EMockHttpClient();

    const syncWorker = new BackgroundSyncWorker({
      terminalId: 'pos_terminal_main',
      branchId: 'branch_hq_01',
      networkListener,
      httpClient: mockHttpClient,
      autoStart: false,
    });

    // Enqueue order lifecycle events into outbox
    await syncWorker.enqueueEvent(customerOrder.id, 'ORDER', 'ORDER_CREATED', {
      orderId: customerOrder.id,
      orderNumber: customerOrder.orderNumber,
    });

    await syncWorker.enqueueEvent(customerOrder.id, 'INVENTORY', 'FIFO_COGS_DEDUCTED', {
      orderId: customerOrder.id,
      totalCogs: totalOrderCogs,
    });

    await syncWorker.enqueueEvent(customerOrder.id, 'LEDGER', 'AUDIT_CHAIN_UPDATED', {
      // İstemci uç noktası taşımaz; yalnızca olayın kendisi kuyruğa girer.
      sequence: 4,
    });

    // Flush outbox to remote
    await syncWorker.triggerPush();

    // Verify remote server received the complete batch
    expect(mockHttpClient.pushedBatches).toHaveLength(1);
    expect(mockHttpClient.pushedBatches[0].records).toHaveLength(3);
    expect(mockHttpClient.pushedBatches[0].terminalId).toBe('pos_terminal_main');
  });

  // =========================================================================
  // Denetim Sözleşmesi: Hash Sızdırmazlığı
  // =========================================================================
  it('never exposes a raw or shortened hash across the IPC surface', async () => {
    // Önce platform defterine bir işlem düşür: boş defter sızdırma kanıtı değildir.
    await tauriInvoke('execute_it_action', {
      callerRole: 'MASTER',
      actionType: 'DIAGNOSTIC_PING',
      tenantId: 'tenant_seal_probe',
    });

    const rows = await tauriInvoke<Array<Record<string, unknown>>>(
      'get_platform_audit_logs',
      { callerRole: 'MASTER' }
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // Hiçbir alan 64 haneli onaltılık değer taşımamalı ve kısaltma üretmemeli.
      for (const value of Object.values(row)) {
        expect(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)).toBe(false);
        expect(typeof value === 'string' && /^[0-9a-f]{8,}$/i.test(value)).toBe(false);
      }
    }

    const csv = buildAuditCsv(
      rows.map((row) => ({
        id: String(row.id ?? ''),
        sequence: Number(row.sequence ?? 0),
        timestamp: String(row.timestamp ?? ''),
        actor_id: String(row.actorId ?? ''),
        actor_role: String(row.actorRole ?? ''),
        category: String(row.category ?? ''),
        action: String(row.action ?? ''),
        resource_id: String(row.resourceId ?? ''),
        payload: null,
        sealed: Boolean(row.sealed),
      }))
    );
    expect(csv.toLowerCase()).not.toContain('hash');
    expect(csv).toContain('Mühürlü');
  });
});
