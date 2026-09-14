import { describe, expect, it, beforeEach } from 'vitest';
import { FifoCostCalculator } from '../../src/domain/usecases/inventory/FifoCostCalculator';
import { RecipeManager } from '../../src/domain/usecases/inventory/RecipeManager';
import { VarianceAnalyzer } from '../../src/domain/usecases/inventory/VarianceAnalyzer';
import { INITIAL_INVENTORY_BATCHES, MOCK_INGREDIENTS, MockSqliteWalDatabase } from '../fixtures/eventStream.fixture';
import { InventoryBatch, WasteRecord, SaleConsumptionRecord } from '../../src/domain/usecases/inventory/types';
import { BackgroundSyncWorker, RealtimeNetworkListener } from '../../src/data/sync/BackgroundSyncWorker';

describe('Inventory & Costing Core Constraints (AGENT 6)', () => {
  let recipeManager: RecipeManager;
  let varianceAnalyzer: VarianceAnalyzer;
  let batches: InventoryBatch[];

  beforeEach(() => {
    recipeManager = new RecipeManager();
    varianceAnalyzer = new VarianceAnalyzer();
    batches = JSON.parse(JSON.stringify(INITIAL_INVENTORY_BATCHES));
  });

  describe('1. Product -> Recipe -> Ingredients & FIFO', () => {
    it('should consume FIFO lots deterministically', () => {
      const result = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, 12);
      expect(result.consumedQuantity).toBe(12);
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].batchId).toBe('batch_beef_001'); // Oldest
      expect(result.allocations[0].quantity).toBe(10);
      expect(result.allocations[1].batchId).toBe('batch_beef_002'); // Next oldest
      expect(result.allocations[1].quantity).toBe(2);
      expect(result.remainingDeficit).toBe(0);
    });

    it('should handle insufficient stock correctly, separating quantity from valuation', () => {
      // 10 + 15 + 20 = 45 beef patties total. Requesting 50.
      const result = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, 50);
      expect(result.consumedQuantity).toBe(45);
      expect(result.remainingDeficit).toBe(5);
      // Valuation of all 45 patties = (10*2.5) + (15*2.75) + (20*3.0) = 25 + 41.25 + 60 = 126.25
      expect(result.totalCogs).toBe(126.25);
    });

    it('should skip expired lots during FIFO consumption', () => {
      const batchesWithExpiry = JSON.parse(JSON.stringify(batches)) as InventoryBatch[];
      // Make the oldest batch expired
      const oldestBatch = batchesWithExpiry.find(b => b.id === 'batch_beef_001');
      if (oldestBatch) {
        oldestBatch.expirationDate = '2020-01-01T00:00:00.000Z'; // Past
      }

      const result = FifoCostCalculator.consumeStock(batchesWithExpiry, MOCK_INGREDIENTS.BEEF_PATTY, 10);
      
      // Should completely skip batch_beef_001 and use batch_beef_002
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].batchId).toBe('batch_beef_002');
      expect(result.allocations[0].quantity).toBe(10);
      expect(result.totalCogs).toBe(27.5); // 10 * 2.75
    });
  });

  describe('2. Recipe Versioning & Historical Costing', () => {
    it('should not change the cost of old sales when recipe version changes', () => {
      // 1. Create Initial Recipe
      recipeManager.createRecipe({
        id: 'rec_cheeseburger',
        name: 'Classic Cheeseburger',
        ingredients: [
          { ingredientId: MOCK_INGREDIENTS.BEEF_PATTY, name: 'Beef', quantity: 1, unit: 'pcs', costPerUnit: 2.5 },
        ],
        yieldQuantity: 1,
      });

      const initialRecipe = recipeManager.getRecipe('rec_cheeseburger');
      const v1Id = initialRecipe!.active_version_id;

      // 2. Change Recipe (Double the beef)
      recipeManager.updateRecipe('rec_cheeseburger', {
        ingredients: [
          { ingredientId: MOCK_INGREDIENTS.BEEF_PATTY, name: 'Beef', quantity: 2, unit: 'pcs', costPerUnit: 2.5 },
        ]
      });

      const updatedRecipe = recipeManager.getRecipe('rec_cheeseburger');
      const v2Id = updatedRecipe!.active_version_id;

      expect(v1Id).not.toBe(v2Id);

      // 3. Process Old Sale (v1)
      const oldSaleVersion = recipeManager.getVersion(v1Id);
      const oldConsumption = FifoCostCalculator.consumeRecipe(batches, oldSaleVersion!, 1);
      expect(oldConsumption.ingredientConsumptions[MOCK_INGREDIENTS.BEEF_PATTY].consumedQuantity).toBe(1);

      // 4. Process New Sale (v2)
      const newSaleVersion = recipeManager.getVersion(v2Id);
      const newConsumption = FifoCostCalculator.consumeRecipe(oldConsumption.updatedBatches, newSaleVersion!, 1);
      expect(newConsumption.ingredientConsumptions[MOCK_INGREDIENTS.BEEF_PATTY].consumedQuantity).toBe(2);
    });
  });

  describe('3. Waste & Variance Auditing', () => {
    it('should audit waste accurately through VarianceAnalyzer', () => {
      recipeManager.createRecipe({
        id: 'rec_fries',
        name: 'Fries',
        ingredients: [
          { ingredientId: MOCK_INGREDIENTS.FRENCH_FRIES, name: 'Fries', quantity: 1, unit: 'portions', costPerUnit: 0.4 },
        ]
      });

      const activeFries = recipeManager.getActiveVersion('rec_fries')!;

      // 1. Simulate a sale
      const sales: SaleConsumptionRecord[] = [
        {
          orderId: 'ord_1',
          recipeId: 'rec_fries',
          recipe_version_id: activeFries.recipe_version_id,
          quantitySold: 10,
          timestamp: new Date().toISOString()
        }
      ];

      // 2. Simulate Waste
      const wasteRecords: WasteRecord[] = [
        {
          id: 'waste_1',
          ingredientId: MOCK_INGREDIENTS.FRENCH_FRIES,
          quantity: 5,
          unitCost: 0.4,
          totalCost: 2.0,
          reason: 'SPOILED',
          timestamp: new Date().toISOString()
        }
      ];

      const consumption = FifoCostCalculator.consumeRecipe(batches, activeFries, 10);

      const report = varianceAnalyzer.analyzeVariance({
        periodStart: new Date(Date.now() - 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
        sales,
        recipeManager,
        actualFifoConsumptionCost: consumption.totalCogs,
        ingredientFifoCogs: {
          [MOCK_INGREDIENTS.FRENCH_FRIES]: consumption.ingredientConsumptions[MOCK_INGREDIENTS.FRENCH_FRIES].totalCogs
        },
        wasteRecords
      });

      const friesVariance = report.ingredientVariances[MOCK_INGREDIENTS.FRENCH_FRIES];
      
      expect(friesVariance.theoreticalCost).toBe(4.0);
      expect(friesVariance.breakdown.actualFifoConsumptionCost).toBe(4.0);
      expect(friesVariance.breakdown.wasteCost).toBe(2.0);
      expect(friesVariance.actualCost).toBe(6.0);
      expect(friesVariance.variance).toBe(2.0);
      expect(friesVariance.isAlert).toBe(true);
    });
  });

  describe('4. Concurrency, Offline & Event Ledger Controls', () => {
    it('should protect against duplicate events (Idempotency Simulation)', () => {
      const processedEventIds = new Set<string>();
      
      const processSale = (eventId: string, qty: number) => {
        if (processedEventIds.has(eventId)) return batches; 
        
        const result = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, qty);
        batches = result.updatedBatches;
        processedEventIds.add(eventId);
        return batches;
      };

      const eventId = 'evt_sale_999';
      
      processSale(eventId, 5);
      const remainingAfterFirst = batches.find(b => b.id === 'batch_beef_001')?.remainingQuantity;
      expect(remainingAfterFirst).toBe(5);

      processSale(eventId, 5);
      const remainingAfterDuplicate = batches.find(b => b.id === 'batch_beef_001')?.remainingQuantity;
      
      expect(remainingAfterDuplicate).toBe(5); 
    });

    it('should queue offline stock operations and recover after sync', async () => {
      const network = new RealtimeNetworkListener();
      network.setOnline(false);

      const db = new MockSqliteWalDatabase();
      let sentEvents = 0;

      const worker = new BackgroundSyncWorker({
        terminalId: 'term1',
        branchId: 'branch1',
        pushEndpointUrl: 'http://mock',
        outboxRepository: {
          getPendingRecords: async () => db.getPendingOutbox(10),
          markInFlight: async () => {},
          markCompleted: async (ids) => {
            for (const id of ids) await db.updateOutboxStatus(id, 'COMPLETED');
          },
          markFailed: async () => {},
          markConflict: async () => {},
          enqueue: async (record) => {
            const outboxRecord = {
              ...record,
              id: 'out_' + Date.now(),
              status: 'PENDING' as const,
              attempts: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              nextRetryAt: new Date().toISOString(),
            };
            await db.insertEvent({
              eventId: record.eventId,
              aggregateId: record.aggregateId,
              aggregateType: record.aggregateType,
              eventType: record.eventType,
              payload: record.payload as any,
              version: record.version,
              timestamp: new Date().toISOString()
            });
            await db.insertOutbox(outboxRecord);
            return outboxRecord;
          },
          getRecordById: async () => null,
          getAllRecords: async () => db.getAllOutbox()
        },
        httpClient: {
          postSyncPush: async () => {
            sentEvents++;
            return { success: true, processedRecordIds: [], serverVectorClock: {}, message: 'Mock' };
          }
        },
        networkListener: network,
        batchSize: 10,
        syncIntervalMs: 1000,
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
        autoStart: false
      });

      await worker.enqueueEvent('inv_01', 'INVENTORY', 'FIFO_DEDUCTION', {
        ingredientId: MOCK_INGREDIENTS.BEEF_PATTY,
        qty: -5
      });

      await worker.triggerPush();
      expect(sentEvents).toBe(0);

      const pending = await db.getPendingOutbox();
      expect(pending).toHaveLength(1);

      network.setOnline(true);
      await worker.triggerPush();

      expect(sentEvents).toBe(1);
      const pendingAfter = await db.getPendingOutbox();
      expect(pendingAfter).toHaveLength(0);
    });

    it('should correctly handle two simultaneous sales without overlapping lot allocations', () => {
      const sale1Qty = 8;
      const sale2Qty = 5;

      const result1 = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, sale1Qty);
      batches = result1.updatedBatches; 

      const result2 = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, sale2Qty);
      batches = result2.updatedBatches; 

      expect(result1.allocations[0].quantity).toBe(8);
      expect(result2.allocations[0].batchId).toBe('batch_beef_001');
      expect(result2.allocations[0].quantity).toBe(2);
      expect(result2.allocations[1].batchId).toBe('batch_beef_002');
      expect(result2.allocations[1].quantity).toBe(3);
    });
  });
});
