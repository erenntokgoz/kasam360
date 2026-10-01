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
import {
  ImmutableLedgerRepository,
  InMemoryLedgerStorageDriver,
  LedgerImmutabilityViolationError,
  LedgerRoleAccessDeniedError,
} from '../../src/data/local/ledger/ImmutableLedgerRepository';
import { HashChainBuilder } from '../../src/domain/entities/ledger/HashChainBuilder';
import { LedgerPrincipal } from '../../src/domain/entities/ledger/types';
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
    // STEP 4: IMMUTABLE LEDGER AUDIT LOGGING & SHA-256 HASH CHAINING
    // -----------------------------------------------------------------------
    const ledgerDriver = new InMemoryLedgerStorageDriver();
    const ledgerRepo = new ImmutableLedgerRepository(ledgerDriver);

    const systemPrincipal: LedgerPrincipal = {
      userId: 'srv_pos_system_01',
      role: 'System',
    };

    // 1. Log ORDER_CREATED
    const entry1 = await ledgerRepo.append(
      {
        actor_id: systemPrincipal.userId,
        actor_role: systemPrincipal.role,
        action: 'order:created',
        resource_id: customerOrder.id,
        payload: {
          orderNumber: customerOrder.orderNumber,
          tableNumber: customerOrder.tableNumber,
          itemCount: customerOrder.items.length,
        },
      },
      systemPrincipal
    );

    // 2. Log KDS_ROUTED
    const entry2 = await ledgerRepo.append(
      {
        actor_id: systemPrincipal.userId,
        actor_role: systemPrincipal.role,
        action: 'kds:station_routed',
        resource_id: customerOrder.id,
        payload: {
          stations: ['Grill', 'Fryer', 'Pizza', 'Bar', 'Prep'],
          itemCount: customerOrder.items.length,
        },
      },
      systemPrincipal
    );

    // 3. Log FIFO_INVENTORY_DEDUCTED
    const entry3 = await ledgerRepo.append(
      {
        actor_id: systemPrincipal.userId,
        actor_role: systemPrincipal.role,
        action: 'inventory:fifo_deducted',
        resource_id: customerOrder.id,
        payload: {
          totalCogs: totalOrderCogs,
          recipesConsumed: ['Cheeseburger', 'Crispy Fries', 'Margherita Pizza'],
        },
      },
      systemPrincipal
    );

    // 4. Log PAYMENT_COMPLETED
    const entry4 = await ledgerRepo.append(
      {
        actor_id: systemPrincipal.userId,
        actor_role: systemPrincipal.role,
        action: 'payment:settled',
        resource_id: customerOrder.id,
        payload: {
          settledAmount: 85.5,
          method: 'CREDIT_CARD',
          authCode: 'AUTH-998877',
        },
      },
      systemPrincipal
    );

    // Assert sequence increments monotonically
    expect(entry1.sequence).toBe(1);
    expect(entry2.sequence).toBe(2);
    expect(entry3.sequence).toBe(3);
    expect(entry4.sequence).toBe(4);

    // Assert cryptographic hash chain links
    expect(entry1.previous_hash).toBe(HashChainBuilder.GENESIS_HASH);
    expect(entry2.previous_hash).toBe(entry1.current_hash);
    expect(entry3.previous_hash).toBe(entry2.current_hash);
    expect(entry4.previous_hash).toBe(entry3.current_hash);

    // Verify cryptographic integrity of full chain
    const integrityResult = await ledgerRepo.validateLedgerIntegrity(systemPrincipal);
    expect(integrityResult.isValid).toBe(true);
    expect(integrityResult.totalEntries).toBe(4);
    expect(integrityResult.verifiedEntries).toBe(4);
    expect(integrityResult.errors).toHaveLength(0);

    // Assert immutability mandate violations throw
    expect(() => ledgerRepo.update()).toThrow(LedgerImmutabilityViolationError);
    expect(() => ledgerRepo.delete()).toThrow(LedgerImmutabilityViolationError);
    expect(() => ledgerRepo.clear()).toThrow(LedgerImmutabilityViolationError);

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

    // Ledger role boundary enforcement:
    const waiterPrincipal: LedgerPrincipal = { userId: 'usr_waiter_01', role: 'WAITER' };
    const kitchenPrincipal: LedgerPrincipal = { userId: 'usr_kitchen_01', role: 'KITCHEN' };
    const ownerPrincipal: LedgerPrincipal = { userId: 'usr_owner_01', role: 'OWNER' };
    const auditorPrincipal: LedgerPrincipal = { userId: 'usr_auditor_01', role: 'Auditor' };

    // Waiter and Kitchen denied from reading ledger
    await expect(ledgerRepo.getEntries(undefined, waiterPrincipal)).rejects.toThrow(
      LedgerRoleAccessDeniedError
    );
    await expect(ledgerRepo.getEntries(undefined, kitchenPrincipal)).rejects.toThrow(
      LedgerRoleAccessDeniedError
    );

    // Owner and Auditor can READ and EXPORT ledger
    const ownerEntries = await ledgerRepo.getEntries(undefined, ownerPrincipal);
    expect(ownerEntries).toHaveLength(4);

    const exportResult = await ledgerRepo.exportLedger(
      { format: 'SECURE_ARCHIVE', prettyPrint: true },
      auditorPrincipal
    );
    expect(exportResult.format).toBe('SECURE_ARCHIVE');
    expect(exportResult.totalRecords).toBe(4);
    expect(exportResult.checksumSha256).toHaveLength(64);

    // Auditor and Owner have zero WRITE permissions on the ledger
    await expect(
      ledgerRepo.append(
        {
          actor_id: ownerPrincipal.userId,
          actor_role: ownerPrincipal.role,
          action: 'malicious:tamper',
          resource_id: customerOrder.id,
          payload: {},
        },
        ownerPrincipal
      )
    ).rejects.toThrow(LedgerRoleAccessDeniedError);

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
      tipHash: entry4.current_hash,
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
  // Tamper Resistance & Cryptographic Detection
  // =========================================================================
  it('detects retroactive ledger payload or sequence tampering immediately', async () => {
    const driver = new InMemoryLedgerStorageDriver();
    const repo = new ImmutableLedgerRepository(driver);
    const systemPrincipal: LedgerPrincipal = { userId: 'system', role: 'System' };

    await repo.append(
      {
        actor_id: 'sys',
        actor_role: 'System',
        action: 'payment',
        resource_id: 'ord_1',
        payload: { amount: 100 },
      },
      systemPrincipal
    );

    await repo.append(
      {
        actor_id: 'sys',
        actor_role: 'System',
        action: 'payment',
        resource_id: 'ord_2',
        payload: { amount: 200 },
      },
      systemPrincipal
    );

    const validEntries = await repo.getEntries(undefined, systemPrincipal);
    expect(HashChainBuilder.verifyChain(validEntries).isValid).toBe(true);

    // Tamper with payload of entry 1 retroactively
    const tamperedEntries = JSON.parse(JSON.stringify(validEntries));
    tamperedEntries[0].payload.amount = 999999; // Fraudulent change

    const invalidResult = HashChainBuilder.verifyChain(tamperedEntries);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors[0].type).toBe('PAYLOAD_TAMPERED');
  });
});
