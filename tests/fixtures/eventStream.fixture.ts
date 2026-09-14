/**
 * Kasam360 - Mock Event-Sourced Transaction Stream Fixtures & SQLite WAL Simulator
 * Path: tests/fixtures/eventStream.fixture.ts
 */

import { InventoryBatch, Recipe, RecipeVersion } from '../../src/domain/usecases/inventory/types';
import { Order, OrderItem } from '../../src/domain/usecases/kds/types';
import { OutboxRecord } from '../../src/data/sync/types';

// ==========================================
// 1. Event Sourcing Schemas & Envelope Types
// ==========================================

export interface EventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  payload: T;
  version: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface InventoryBatchIngestedPayload {
  batchId: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  receivedAt: string;
  supplierId: string;
}

export interface OrderCreatedPayload {
  orderId: string;
  orderNumber: string;
  tableNumber: string;
  serverId: string;
  terminalId: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category: string;
  }>;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
}

export interface KdsRoutingPayload {
  orderId: string;
  routedAt: string;
  stationAllocations: Record<string, string[]>; // station -> itemIds
}

export interface FifoDeductionPayload {
  orderId: string;
  recipeId: string;
  recipeVersionId: string;
  portionsSold: number;
  totalCogs: number;
  blendedUnitCost: number;
  allocations: Array<{
    batchId: string;
    ingredientId: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }>;
}

export interface LedgerAuditPayload {
  sequence: number;
  previousHash: string;
  currentHash: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceId: string;
  digest: string;
}

// ==========================================
// 2. Pre-Configured Mock Inventory Batches
// ==========================================

export const MOCK_INGREDIENTS = {
  BEEF_PATTY: 'ing_beef_patty',
  BURGER_BUN: 'ing_burger_bun',
  CHEDDAR_CHEESE: 'ing_cheddar_cheese',
  FRENCH_FRIES: 'ing_french_fries',
  PIZZA_DOUGH: 'ing_pizza_dough',
  MOZZARELLA: 'ing_mozzarella',
  TOMATO_SAUCE: 'ing_tomato_sauce',
  CRAFT_BEER: 'ing_craft_beer',
  SALAD_GREENS: 'ing_salad_greens',
} as const;

export const INITIAL_INVENTORY_BATCHES: InventoryBatch[] = [
  // Beef Patties (3 chronological batches at different cost points)
  {
    id: 'batch_beef_001',
    ingredientId: MOCK_INGREDIENTS.BEEF_PATTY,
    receivedAt: '2026-09-01T08:00:00.000Z',
    initialQuantity: 10,
    remainingQuantity: 10,
    unitCost: 2.5,
    unit: 'pcs',
    supplierId: 'sup_meat_depot',
    batchNumber: 'LOT-BEEF-01',
  },
  {
    id: 'batch_beef_002',
    ingredientId: MOCK_INGREDIENTS.BEEF_PATTY,
    receivedAt: '2026-09-02T08:00:00.000Z',
    initialQuantity: 15,
    remainingQuantity: 15,
    unitCost: 2.75,
    unit: 'pcs',
    supplierId: 'sup_meat_depot',
    batchNumber: 'LOT-BEEF-02',
  },
  {
    id: 'batch_beef_003',
    ingredientId: MOCK_INGREDIENTS.BEEF_PATTY,
    receivedAt: '2026-09-03T08:00:00.000Z',
    initialQuantity: 20,
    remainingQuantity: 20,
    unitCost: 3.0,
    unit: 'pcs',
    supplierId: 'sup_meat_depot',
    batchNumber: 'LOT-BEEF-03',
  },

  // Burger Buns (2 chronological batches)
  {
    id: 'batch_buns_001',
    ingredientId: MOCK_INGREDIENTS.BURGER_BUN,
    receivedAt: '2026-09-01T07:00:00.000Z',
    initialQuantity: 30,
    remainingQuantity: 30,
    unitCost: 0.5,
    unit: 'pcs',
    supplierId: 'sup_bakery',
    batchNumber: 'LOT-BUNS-01',
  },
  {
    id: 'batch_buns_002',
    ingredientId: MOCK_INGREDIENTS.BURGER_BUN,
    receivedAt: '2026-09-02T07:00:00.000Z',
    initialQuantity: 50,
    remainingQuantity: 50,
    unitCost: 0.6,
    unit: 'pcs',
    supplierId: 'sup_bakery',
    batchNumber: 'LOT-BUNS-02',
  },

  // Cheddar Cheese (1 batch)
  {
    id: 'batch_cheese_001',
    ingredientId: MOCK_INGREDIENTS.CHEDDAR_CHEESE,
    receivedAt: '2026-09-01T07:30:00.000Z',
    initialQuantity: 25,
    remainingQuantity: 25,
    unitCost: 0.8,
    unit: 'slices',
    supplierId: 'sup_dairy',
    batchNumber: 'LOT-CHEESE-01',
  },

  // French Fries (1 batch)
  {
    id: 'batch_fries_001',
    ingredientId: MOCK_INGREDIENTS.FRENCH_FRIES,
    receivedAt: '2026-09-01T06:00:00.000Z',
    initialQuantity: 40,
    remainingQuantity: 40,
    unitCost: 0.4,
    unit: 'portions',
    supplierId: 'sup_frozen',
    batchNumber: 'LOT-FRIES-01',
  },

  // Pizza Dough (2 batches)
  {
    id: 'batch_dough_001',
    ingredientId: MOCK_INGREDIENTS.PIZZA_DOUGH,
    receivedAt: '2026-09-01T06:30:00.000Z',
    initialQuantity: 15,
    remainingQuantity: 15,
    unitCost: 1.2,
    unit: 'bases',
    supplierId: 'sup_bakery',
    batchNumber: 'LOT-DOUGH-01',
  },
  {
    id: 'batch_dough_002',
    ingredientId: MOCK_INGREDIENTS.PIZZA_DOUGH,
    receivedAt: '2026-09-02T06:30:00.000Z',
    initialQuantity: 25,
    remainingQuantity: 25,
    unitCost: 1.35,
    unit: 'bases',
    supplierId: 'sup_bakery',
    batchNumber: 'LOT-DOUGH-02',
  },

  // Mozzarella
  {
    id: 'batch_mozz_001',
    ingredientId: MOCK_INGREDIENTS.MOZZARELLA,
    receivedAt: '2026-09-01T06:45:00.000Z',
    initialQuantity: 20,
    remainingQuantity: 20,
    unitCost: 1.5,
    unit: 'portions',
    supplierId: 'sup_dairy',
    batchNumber: 'LOT-MOZZ-01',
  },

  // Tomato Sauce
  {
    id: 'batch_sauce_001',
    ingredientId: MOCK_INGREDIENTS.TOMATO_SAUCE,
    receivedAt: '2026-09-01T06:50:00.000Z',
    initialQuantity: 30,
    remainingQuantity: 30,
    unitCost: 0.7,
    unit: 'portions',
    supplierId: 'sup_pantry',
    batchNumber: 'LOT-SAUCE-01',
  },

  // Craft Beer (Bar station item)
  {
    id: 'batch_beer_001',
    ingredientId: MOCK_INGREDIENTS.CRAFT_BEER,
    receivedAt: '2026-09-01T05:00:00.000Z',
    initialQuantity: 60,
    remainingQuantity: 60,
    unitCost: 2.0,
    unit: 'bottles',
    supplierId: 'sup_brewery',
    batchNumber: 'LOT-BEER-01',
  },

  // Salad Greens (Prep station item)
  {
    id: 'batch_salad_001',
    ingredientId: MOCK_INGREDIENTS.SALAD_GREENS,
    receivedAt: '2026-09-01T06:15:00.000Z',
    initialQuantity: 20,
    remainingQuantity: 20,
    unitCost: 0.9,
    unit: 'bowls',
    supplierId: 'sup_fresh_produce',
    batchNumber: 'LOT-SALAD-01',
  },
];

// ==========================================
// 3. Pre-Configured Mock Recipes
// ==========================================

export const MOCK_CHEESEBURGER_RECIPE_VERSION: RecipeVersion = {
  recipe_version_id: 'rec_ver_cheeseburger_v1',
  recipeId: 'rec_cheeseburger',
  versionNumber: 1,
  ingredients: [
    {
      ingredientId: MOCK_INGREDIENTS.BEEF_PATTY,
      name: 'Beef Patty',
      quantity: 1,
      unit: 'pcs',
      costPerUnit: 2.5,
    },
    {
      ingredientId: MOCK_INGREDIENTS.BURGER_BUN,
      name: 'Burger Bun',
      quantity: 1,
      unit: 'pcs',
      costPerUnit: 0.5,
    },
    {
      ingredientId: MOCK_INGREDIENTS.CHEDDAR_CHEESE,
      name: 'Cheddar Cheese',
      quantity: 1,
      unit: 'slices',
      costPerUnit: 0.8,
    },
  ],
  yieldQuantity: 1,
  theoreticalCostPerUnit: 3.8,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
};

export const MOCK_CHEESEBURGER_RECIPE: Recipe = {
  id: 'rec_cheeseburger',
  name: 'Classic Cheeseburger',
  sku: 'BURG-001',
  category: 'Burgers',
  active_version_id: 'rec_ver_cheeseburger_v1',
  versions: [MOCK_CHEESEBURGER_RECIPE_VERSION],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const MOCK_MARGHERITA_RECIPE_VERSION: RecipeVersion = {
  recipe_version_id: 'rec_ver_margherita_v1',
  recipeId: 'rec_margherita',
  versionNumber: 1,
  ingredients: [
    {
      ingredientId: MOCK_INGREDIENTS.PIZZA_DOUGH,
      name: 'Pizza Dough',
      quantity: 1,
      unit: 'bases',
      costPerUnit: 1.2,
    },
    {
      ingredientId: MOCK_INGREDIENTS.MOZZARELLA,
      name: 'Mozzarella',
      quantity: 1,
      unit: 'portions',
      costPerUnit: 1.5,
    },
    {
      ingredientId: MOCK_INGREDIENTS.TOMATO_SAUCE,
      name: 'Tomato Sauce',
      quantity: 1,
      unit: 'portions',
      costPerUnit: 0.7,
    },
  ],
  yieldQuantity: 1,
  theoreticalCostPerUnit: 3.4,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
};

export const MOCK_CRISPY_FRIES_RECIPE_VERSION: RecipeVersion = {
  recipe_version_id: 'rec_ver_fries_v1',
  recipeId: 'rec_fries',
  versionNumber: 1,
  ingredients: [
    {
      ingredientId: MOCK_INGREDIENTS.FRENCH_FRIES,
      name: 'French Fries',
      quantity: 1,
      unit: 'portions',
      costPerUnit: 0.4,
    },
  ],
  yieldQuantity: 1,
  theoreticalCostPerUnit: 0.4,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
};

// ==========================================
// 4. Sample Multi-Station Orders
// ==========================================

export function createSampleOrder(params?: {
  id?: string;
  orderNumber?: string;
  tableNumber?: string;
}): Order {
  const items: OrderItem[] = [
    {
      id: 'item_grill_01',
      name: 'Classic Cheeseburger',
      quantity: 2,
      category: 'Burgers',
      productType: 'Burger',
    },
    {
      id: 'item_fryer_01',
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
      id: 'item_bar_01',
      name: 'Craft IPA Beer',
      quantity: 2,
      category: 'Beverages',
      productType: 'Beer',
    },
    {
      id: 'item_prep_01',
      name: 'Chef Garden Salad',
      quantity: 1,
      category: 'Appetizers',
      productType: 'Salad',
    },
  ];

  return {
    id: params?.id ?? `ord_${Date.now()}_01`,
    orderNumber: params?.orderNumber ?? 'ORD-101',
    tableNumber: params?.tableNumber ?? 'Table 4',
    items,
    createdAt: new Date().toISOString(),
    priority: 'NORMAL',
  };
}

// ==========================================
// 5. Mock Event-Sourced Transaction Stream Generator
// ==========================================

export function generateMockEventStream(): EventEnvelope[] {
  const stream: EventEnvelope[] = [];
  const baseTimestamp = new Date('2026-09-05T12:00:00.000Z').getTime();

  // 1. Ingestion Events (Inventory Received)
  INITIAL_INVENTORY_BATCHES.slice(0, 4).forEach((batch, index) => {
    stream.push({
      eventId: `evt_ingest_${index + 1}`,
      aggregateId: batch.id,
      aggregateType: 'INVENTORY_BATCH',
      eventType: 'BATCH_INGESTED',
      payload: {
        batchId: batch.id,
        ingredientId: batch.ingredientId,
        quantity: batch.initialQuantity,
        unitCost: batch.unitCost,
        receivedAt: batch.receivedAt,
      },
      version: 1,
      timestamp: new Date(baseTimestamp + index * 60000).toISOString(),
    });
  });

  // 2. POS Order Generation Event
  const order = createSampleOrder();
  stream.push({
    eventId: 'evt_order_001',
    aggregateId: order.id,
    aggregateType: 'ORDER',
    eventType: 'ORDER_PLACED',
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      itemCount: order.items.length,
      items: order.items,
    },
    version: 1,
    timestamp: new Date(baseTimestamp + 300000).toISOString(),
  });

  // 3. KDS Station Routing Event
  stream.push({
    eventId: 'evt_kds_route_001',
    aggregateId: order.id,
    aggregateType: 'KDS_TICKET',
    eventType: 'ORDER_ROUTED_TO_STATIONS',
    payload: {
      orderId: order.id,
      routedAt: new Date(baseTimestamp + 305000).toISOString(),
      stationMap: {
        Grill: ['item_grill_01'],
        Fryer: ['item_fryer_01'],
        Pizza: ['item_pizza_01'],
        Bar: ['item_bar_01'],
        Prep: ['item_prep_01'],
      },
    },
    version: 2,
    timestamp: new Date(baseTimestamp + 305000).toISOString(),
  });

  // 4. FIFO Inventory Deduction Event
  stream.push({
    eventId: 'evt_fifo_deduct_001',
    aggregateId: order.id,
    aggregateType: 'INVENTORY_ALLOCATION',
    eventType: 'FIFO_STOCK_DEDUCTED',
    payload: {
      orderId: order.id,
      recipeId: MOCK_CHEESEBURGER_RECIPE_VERSION.recipeId,
      portionsSold: 2,
      totalCogs: 7.6,
      allocations: [
        { batchId: 'batch_beef_001', ingredientId: MOCK_INGREDIENTS.BEEF_PATTY, quantity: 2, unitCost: 2.5, totalCost: 5.0 },
        { batchId: 'batch_buns_001', ingredientId: MOCK_INGREDIENTS.BURGER_BUN, quantity: 2, unitCost: 0.5, totalCost: 1.0 },
        { batchId: 'batch_cheese_001', ingredientId: MOCK_INGREDIENTS.CHEDDAR_CHEESE, quantity: 2, unitCost: 0.8, totalCost: 1.6 },
      ],
    },
    version: 3,
    timestamp: new Date(baseTimestamp + 310000).toISOString(),
  });

  return stream;
}

// ==========================================
// 6. SQLite WAL Database Simulator
// ==========================================

export interface SqliteWalRecord {
  table: string;
  key: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/**
 * Headless SQLite WAL (Write-Ahead-Log) Simulator mimicking schema.sql constraints.
 */
export class MockSqliteWalDatabase {
  private eventsTable: Map<string, EventEnvelope> = new Map();
  private outboxTable: Map<string, OutboxRecord> = new Map();
  private snapshotsTable: Map<string, { aggregateId: string; aggregateType: string; latestVersion: number; statePayload: string; updatedAt: string }> = new Map();
  
  // Write-Ahead-Log buffer
  private walBuffer: SqliteWalRecord[] = [];
  private isWalLocked = false;
  private journalMode = 'WAL';

  public constructor() {
    this.journalMode = 'WAL';
  }

  public getJournalMode(): string {
    return this.journalMode;
  }

  /**
   * Appends an event to the events table through the simulated WAL journal.
   */
  public async insertEvent<T = Record<string, unknown>>(event: EventEnvelope<T>): Promise<void> {
    if (this.isWalLocked) {
      throw new Error('SQLITE_BUSY: database is locked (WAL concurrency contention)');
    }

    // Check primary key constraint
    if (this.eventsTable.has(event.eventId)) {
      throw new Error(`SQLITE_CONSTRAINT: UNIQUE constraint failed: events.event_id (${event.eventId})`);
    }

    // Write to WAL journal
    this.walBuffer.push({
      table: 'events',
      key: event.eventId,
      data: event as unknown as Record<string, unknown>,
      createdAt: event.timestamp,
    });

    // Checkpoint into storage
    this.eventsTable.set(event.eventId, event as unknown as EventEnvelope);
  }

  /**
   * Inserts an outbox record with foreign key check against events table.
   */
  public async insertOutbox(record: OutboxRecord): Promise<void> {
    if (this.isWalLocked) {
      throw new Error('SQLITE_BUSY: database is locked');
    }

    // Primary key check
    if (this.outboxTable.has(record.id)) {
      throw new Error(`SQLITE_CONSTRAINT: UNIQUE constraint failed: outbox.id (${record.id})`);
    }

    // Foreign key check against events table
    if (!this.eventsTable.has(record.eventId)) {
      throw new Error(`SQLITE_CONSTRAINT: FOREIGN KEY constraint failed on event_id (${record.eventId})`);
    }

    this.walBuffer.push({
      table: 'outbox',
      key: record.id,
      data: record as unknown as Record<string, unknown>,
      createdAt: record.createdAt,
    });

    this.outboxTable.set(record.id, { ...record });
  }

  /**
   * Updates outbox record status.
   */
  public async updateOutboxStatus(
    id: string,
    status: OutboxRecord['status'],
    error?: string,
    nextRetryAt?: string,
    incrementAttempts = false
  ): Promise<void> {
    const record = this.outboxTable.get(id);
    if (!record) {
      throw new Error(`Outbox record not found: ${id}`);
    }

    if (incrementAttempts) {
      record.attempts += 1;
    }
    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (error !== undefined) {
      record.lastError = error;
    }
    if (nextRetryAt !== undefined) {
      record.nextRetryAt = nextRetryAt;
    }

    this.walBuffer.push({
      table: 'outbox',
      key: id,
      data: { ...record },
      createdAt: record.updatedAt,
    });
  }

  public async getPendingOutbox(limit = 50): Promise<OutboxRecord[]> {
    const now = Date.now();
    return Array.from(this.outboxTable.values())
      .filter((r) => {
        if (r.status !== 'PENDING') return false;
        if (!r.nextRetryAt) return true;
        return new Date(r.nextRetryAt).getTime() <= now;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, limit);
  }

  public async getOutboxById(id: string): Promise<OutboxRecord | null> {
    const record = this.outboxTable.get(id);
    return record ? { ...record } : null;
  }

  public async getAllOutbox(): Promise<OutboxRecord[]> {
    return Array.from(this.outboxTable.values()).map((r) => ({ ...r }));
  }

  public async getEventsByAggregate(aggregateId: string): Promise<EventEnvelope[]> {
    return Array.from(this.eventsTable.values())
      .filter((e) => e.aggregateId === aggregateId)
      .sort((a, b) => a.version - b.version);
  }

  public async saveSnapshot(
    aggregateId: string,
    aggregateType: string,
    latestVersion: number,
    state: unknown
  ): Promise<void> {
    const snapshot = {
      aggregateId,
      aggregateType,
      latestVersion,
      statePayload: JSON.stringify(state),
      updatedAt: new Date().toISOString(),
    };
    this.snapshotsTable.set(aggregateId, snapshot);
  }

  public async getSnapshot(aggregateId: string): Promise<unknown | null> {
    const snapshot = this.snapshotsTable.get(aggregateId);
    return snapshot ? JSON.parse(snapshot.statePayload) : null;
  }

  public simulateWalLock(locked: boolean): void {
    this.isWalLocked = locked;
  }

  public getWalLog(): readonly SqliteWalRecord[] {
    return [...this.walBuffer];
  }

  public checkpointWal(): number {
    const flushedCount = this.walBuffer.length;
    this.walBuffer = [];
    return flushedCount;
  }
}
