/**
 * Kasam360 - FIFO Cost Calculation & Financial Verification Test Suite
 * Path: tests/integration/fifoCost.test.ts
 */


import { FifoCostCalculator } from '../../src/domain/usecases/inventory/FifoCostCalculator';
import { InventoryBatch } from '../../src/domain/usecases/inventory/types';
import {
  INITIAL_INVENTORY_BATCHES,
  MOCK_CHEESEBURGER_RECIPE_VERSION,
  MOCK_INGREDIENTS,
  MOCK_MARGHERITA_RECIPE_VERSION,
} from '../fixtures/eventStream.fixture';

describe('FifoCostCalculator - FIFO Cost Calculation Verification Suite', () => {
  // Helper to get fresh deep-cloned batches for isolated test execution
  const getCleanBatches = (): InventoryBatch[] =>
    JSON.parse(JSON.stringify(INITIAL_INVENTORY_BATCHES));

  // =========================================================================
  // 1. Chronological Sorting & Sequencing Mandate
  // =========================================================================
  describe('Batch Sequencing & Chronological Ordering', () => {
    it('strictly sorts batches in ascending chronological order (oldest first)', () => {
      const beefBatches = getCleanBatches().filter(
        (b) => b.ingredientId === MOCK_INGREDIENTS.BEEF_PATTY
      );

      // Scramble batches intentionally
      const scrambled = [beefBatches[2], beefBatches[0], beefBatches[1]];

      const sorted = FifoCostCalculator.sortBatchesFifo(scrambled);

      expect(sorted[0].id).toBe('batch_beef_001');
      expect(sorted[1].id).toBe('batch_beef_002');
      expect(sorted[2].id).toBe('batch_beef_003');
      expect(new Date(sorted[0].receivedAt).getTime()).toBeLessThan(
        new Date(sorted[1].receivedAt).getTime()
      );
      expect(new Date(sorted[1].receivedAt).getTime()).toBeLessThan(
        new Date(sorted[2].receivedAt).getTime()
      );
    });

    it('uses batch ID as secondary deterministic tie-breaker when receivedAt timestamps are identical', () => {
      const timestamp = '2026-09-01T10:00:00.000Z';
      const identicalBatches: InventoryBatch[] = [
        {
          id: 'batch_z',
          ingredientId: 'ing_test',
          receivedAt: timestamp,
          initialQuantity: 10,
          remainingQuantity: 10,
          unitCost: 1.0,
          unit: 'pcs',
        },
        {
          id: 'batch_a',
          ingredientId: 'ing_test',
          receivedAt: timestamp,
          initialQuantity: 10,
          remainingQuantity: 10,
          unitCost: 1.0,
          unit: 'pcs',
        },
      ];

      const sorted = FifoCostCalculator.sortBatchesFifo(identicalBatches);
      expect(sorted[0].id).toBe('batch_a');
      expect(sorted[1].id).toBe('batch_z');
    });
  });

  // =========================================================================
  // 2. Exact COGS & Single Batch Partial Depletion
  // =========================================================================
  describe('Single-Batch Partial Depletion & COGS Precision', () => {
    it('consumes stock from the oldest batch without touching subsequent batches', () => {
      const batches = getCleanBatches();
      const requestedQty = 6;

      const result = FifoCostCalculator.consumeStock(
        batches,
        MOCK_INGREDIENTS.BEEF_PATTY,
        requestedQty
      );

      expect(result.requestedQuantity).toBe(6);
      expect(result.consumedQuantity).toBe(6);
      expect(result.remainingDeficit).toBe(0);

      // Batch 1 has 10 units @ 2.50 -> 6 units * 2.50 = 15.00
      expect(result.totalCogs).toBe(15.0);
      expect(result.blendedUnitCost).toBe(2.5);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]).toEqual({
        batchId: 'batch_beef_001',
        quantity: 6,
        unitCost: 2.5,
        totalCost: 15.0,
      });

      // Assert updated batches state
      const updatedBatch1 = result.updatedBatches.find((b) => b.id === 'batch_beef_001');
      const updatedBatch2 = result.updatedBatches.find((b) => b.id === 'batch_beef_002');
      const updatedBatch3 = result.updatedBatches.find((b) => b.id === 'batch_beef_003');

      expect(updatedBatch1?.remainingQuantity).toBe(4); // 10 - 6 = 4
      expect(updatedBatch2?.remainingQuantity).toBe(15); // Untouched
      expect(updatedBatch3?.remainingQuantity).toBe(20); // Untouched
    });
  });

  // =========================================================================
  // 3. Multi-Batch Boundary Crossover (Fractional Depletion)
  // =========================================================================
  describe('Multi-Batch Depletion & Blended Unit Cost Calculation', () => {
    it('depletes the oldest batch completely and consumes remaining requirement from next chronological batch', () => {
      const batches = getCleanBatches();
      // Batch 1: 10 @ $2.50, Batch 2: 15 @ $2.75, Batch 3: 20 @ $3.00
      // Requesting 18 units: 10 from Batch 1 + 8 from Batch 2
      const requestedQty = 18;

      const result = FifoCostCalculator.consumeStock(
        batches,
        MOCK_INGREDIENTS.BEEF_PATTY,
        requestedQty
      );

      expect(result.consumedQuantity).toBe(18);
      expect(result.remainingDeficit).toBe(0);

      // Expected COGS: (10 * 2.50) + (8 * 2.75) = 25.00 + 22.00 = 47.00
      expect(result.totalCogs).toBe(47.0);

      // Blended Unit Cost: 47.00 / 18 = 2.6111
      expect(result.blendedUnitCost).toBe(2.6111);

      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0]).toEqual({
        batchId: 'batch_beef_001',
        quantity: 10,
        unitCost: 2.5,
        totalCost: 25.0,
      });
      expect(result.allocations[1]).toEqual({
        batchId: 'batch_beef_002',
        quantity: 8,
        unitCost: 2.75,
        totalCost: 22.0,
      });

      // Verify batch quantities
      const b1 = result.updatedBatches.find((b) => b.id === 'batch_beef_001');
      const b2 = result.updatedBatches.find((b) => b.id === 'batch_beef_002');
      const b3 = result.updatedBatches.find((b) => b.id === 'batch_beef_003');

      expect(b1?.remainingQuantity).toBe(0); // Fully depleted
      expect(b2?.remainingQuantity).toBe(7); // 15 - 8 = 7
      expect(b3?.remainingQuantity).toBe(20); // Untouched
    });

    it('transitions across 3 batches when consumption spans multiple chronological layers', () => {
      const batches = getCleanBatches();
      // Requesting 30 units:
      // 10 from Batch 1 (@ 2.50) = 25.00
      // 15 from Batch 2 (@ 2.75) = 41.25
      // 5 from Batch 3 (@ 3.00) = 15.00
      // Total COGS: 81.25, Blended: 81.25 / 30 = 2.7083
      const result = FifoCostCalculator.consumeStock(
        batches,
        MOCK_INGREDIENTS.BEEF_PATTY,
        30
      );

      expect(result.consumedQuantity).toBe(30);
      expect(result.totalCogs).toBe(81.25);
      expect(result.blendedUnitCost).toBe(2.7083);
      expect(result.allocations).toHaveLength(3);

      const b1 = result.updatedBatches.find((b) => b.id === 'batch_beef_001');
      const b2 = result.updatedBatches.find((b) => b.id === 'batch_beef_002');
      const b3 = result.updatedBatches.find((b) => b.id === 'batch_beef_003');

      expect(b1?.remainingQuantity).toBe(0);
      expect(b2?.remainingQuantity).toBe(0);
      expect(b3?.remainingQuantity).toBe(15); // 20 - 5 = 15
    });
  });

  // =========================================================================
  // 4. Stock Exhaustion & Deficit Handling
  // =========================================================================
  describe('Stock Exhaustion & Inventory Deficit Handling', () => {
    it('depletes all batches to zero and returns remaining deficit when demand exceeds on-hand inventory', () => {
      const batches = getCleanBatches();
      // Total beef available: 10 + 15 + 20 = 45 units
      const requestedQty = 55;

      const result = FifoCostCalculator.consumeStock(
        batches,
        MOCK_INGREDIENTS.BEEF_PATTY,
        requestedQty
      );

      expect(result.requestedQuantity).toBe(55);
      expect(result.consumedQuantity).toBe(45);
      expect(result.remainingDeficit).toBe(10); // 55 - 45 = 10 units unfulfilled

      // Total COGS for all available stock: 25.00 + 41.25 + 60.00 = 126.25
      expect(result.totalCogs).toBe(126.25);
      expect(result.blendedUnitCost).toBe(Math.round((126.25 / 45) * 10000) / 10000);

      // Assert all batches are at 0 and none are negative
      const beefBatches = result.updatedBatches.filter(
        (b) => b.ingredientId === MOCK_INGREDIENTS.BEEF_PATTY
      );
      for (const batch of beefBatches) {
        expect(batch.remainingQuantity).toBe(0);
      }
    });

    it('returns full deficit and zero COGS when ingredient has no active stock', () => {
      const batches = getCleanBatches();
      const result = FifoCostCalculator.consumeStock(
        batches,
        'non_existent_ingredient',
        10
      );

      expect(result.consumedQuantity).toBe(0);
      expect(result.totalCogs).toBe(0);
      expect(result.blendedUnitCost).toBe(0);
      expect(result.allocations).toHaveLength(0);
      expect(result.remainingDeficit).toBe(10);
    });
  });

  // =========================================================================
  // 5. Multi-Ingredient Recipe Consumption
  // =========================================================================
  describe('Recipe Consumption Engine (consumeRecipe)', () => {
    it('consumes multiple ingredients proportionally and generates granular stock movements', () => {
      const batches = getCleanBatches();
      const portionsSold = 5;
      const orderId = 'ord_test_fifo_001';

      const result = FifoCostCalculator.consumeRecipe(
        batches,
        MOCK_CHEESEBURGER_RECIPE_VERSION,
        portionsSold,
        orderId
      );

      expect(result.recipe_version_id).toBe(MOCK_CHEESEBURGER_RECIPE_VERSION.recipe_version_id);
      expect(result.portionsSold).toBe(5);

      // Theoretical Cost: (5 * 2.50 beef) + (5 * 0.50 bun) + (5 * 0.80 cheese) = 12.50 + 2.50 + 4.00 = 19.00
      expect(result.totalCogs).toBe(19.0);

      // Verify each ingredient's consumption record
      const beefConsumption = result.ingredientConsumptions[MOCK_INGREDIENTS.BEEF_PATTY];
      const bunConsumption = result.ingredientConsumptions[MOCK_INGREDIENTS.BURGER_BUN];
      const cheeseConsumption = result.ingredientConsumptions[MOCK_INGREDIENTS.CHEDDAR_CHEESE];

      expect(beefConsumption.consumedQuantity).toBe(5);
      expect(beefConsumption.totalCogs).toBe(12.5);

      expect(bunConsumption.consumedQuantity).toBe(5);
      expect(bunConsumption.totalCogs).toBe(2.5);

      expect(cheeseConsumption.consumedQuantity).toBe(5);
      expect(cheeseConsumption.totalCogs).toBe(4.0);

      // Verify generated StockMovement records
      expect(result.movements).toHaveLength(3);
      for (const mov of result.movements) {
        expect(mov.type).toBe('SALE_CONSUMPTION');
        expect(mov.referenceId).toBe(orderId);
        expect(mov.quantity).toBe(-5);
        expect(mov.recipe_version_id).toBe(MOCK_CHEESEBURGER_RECIPE_VERSION.recipe_version_id);
      }
    });

    it('accurately calculates recipe COGS across multi-batch boundaries', () => {
      const batches = getCleanBatches();
      // Margherita Pizza uses:
      // 1 Pizza Dough (Batch 1 has 15 @ 1.20, Batch 2 has 25 @ 1.35)
      // 1 Mozzarella (Batch 1 has 20 @ 1.50)
      // 1 Tomato Sauce (Batch 1 has 30 @ 0.70)
      // If we sell 18 pizzas:
      // Dough: 15 from B1 (18.00) + 3 from B2 (4.05) = 22.05
      // Mozzarella: 18 from B1 @ 1.50 = 27.00
      // Sauce: 18 from B1 @ 0.70 = 12.60
      // Total COGS: 22.05 + 27.00 + 12.60 = 61.65
      const result = FifoCostCalculator.consumeRecipe(
        batches,
        MOCK_MARGHERITA_RECIPE_VERSION,
        18,
        'ord_pizza_rush_001'
      );

      expect(result.totalCogs).toBe(61.65);

      const doughConsumption = result.ingredientConsumptions[MOCK_INGREDIENTS.PIZZA_DOUGH];
      expect(doughConsumption.allocations).toHaveLength(2);
      expect(doughConsumption.allocations[0].quantity).toBe(15);
      expect(doughConsumption.allocations[0].unitCost).toBe(1.2);
      expect(doughConsumption.allocations[1].quantity).toBe(3);
      expect(doughConsumption.allocations[1].unitCost).toBe(1.35);

      // Assert remaining dough in batch 2
      const updatedDough2 = result.updatedBatches.find((b) => b.id === 'batch_dough_002');
      expect(updatedDough2?.remainingQuantity).toBe(22); // 25 - 3 = 22
    });

    it('throws descriptive error if portionsSold is zero or negative', () => {
      const batches = getCleanBatches();
      expect(() => {
        FifoCostCalculator.consumeRecipe(batches, MOCK_CHEESEBURGER_RECIPE_VERSION, 0);
      }).toThrow('Portions sold must be greater than zero.');

      expect(() => {
        FifoCostCalculator.consumeRecipe(batches, MOCK_CHEESEBURGER_RECIPE_VERSION, -5);
      }).toThrow('Portions sold must be greater than zero.');
    });
  });

  // =========================================================================
  // 6. Cumulative Sales Event Sequence & Conservation of Value
  // =========================================================================
  describe('Cumulative Multi-Order Sales Sequence', () => {
    it('preserves conservation of financial value across multiple successive orders', () => {
      let currentBatches = getCleanBatches();
      const initialValuation = FifoCostCalculator.calculateInventoryValuation(currentBatches);

      let cumulativeCogs = 0;

      // Order 1: 8 Cheeseburgers
      const r1 = FifoCostCalculator.consumeRecipe(
        currentBatches,
        MOCK_CHEESEBURGER_RECIPE_VERSION,
        8,
        'ord_seq_001'
      );
      currentBatches = r1.updatedBatches;
      cumulativeCogs += r1.totalCogs;

      // Order 2: 5 Cheeseburgers (crosses Beef Batch 1 into Batch 2)
      const r2 = FifoCostCalculator.consumeRecipe(
        currentBatches,
        MOCK_CHEESEBURGER_RECIPE_VERSION,
        5,
        'ord_seq_002'
      );
      currentBatches = r2.updatedBatches;
      cumulativeCogs += r2.totalCogs;

      // Order 3: 10 Margherita Pizzas
      const r3 = FifoCostCalculator.consumeRecipe(
        currentBatches,
        MOCK_MARGHERITA_RECIPE_VERSION,
        10,
        'ord_seq_003'
      );
      currentBatches = r3.updatedBatches;
      cumulativeCogs += r3.totalCogs;

      // Post-sales valuation
      const postValuation = FifoCostCalculator.calculateInventoryValuation(currentBatches);

      // Financial invariant: Ending Valuation + Cumulative COGS === Starting Valuation
      const endingPlusCogs =
        Math.round((postValuation.totalValuation + cumulativeCogs) * 10000) / 10000;
      expect(endingPlusCogs).toBe(initialValuation.totalValuation);
    });
  });

  // =========================================================================
  // 7. Immutability Guarantee
  // =========================================================================
  describe('State Immutability Guarantee', () => {
    it('never mutates the input batches array or its elements in place', () => {
      const originalBatches = getCleanBatches();
      const originalSnapshot = JSON.stringify(originalBatches);

      FifoCostCalculator.consumeStock(originalBatches, MOCK_INGREDIENTS.BEEF_PATTY, 8);

      // Assert input array was unchanged
      expect(JSON.stringify(originalBatches)).toBe(originalSnapshot);
    });
  });

  // =========================================================================
  // 8. Edge Cases & Zero Handlers
  // =========================================================================
  describe('Defensive Edge Cases', () => {
    it('returns zero COGS and unmutated batches when quantity to consume is 0 or negative', () => {
      const batches = getCleanBatches();
      const resultZero = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, 0);

      expect(resultZero.totalCogs).toBe(0);
      expect(resultZero.consumedQuantity).toBe(0);
      expect(resultZero.allocations).toHaveLength(0);

      const resultNeg = FifoCostCalculator.consumeStock(batches, MOCK_INGREDIENTS.BEEF_PATTY, -10);
      expect(resultNeg.totalCogs).toBe(0);
      expect(resultNeg.consumedQuantity).toBe(0);
      expect(resultNeg.allocations).toHaveLength(0);
    });
  });
});
