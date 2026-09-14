import {
  FifoAllocation,
  FifoConsumptionResult,
  InventoryBatch,
  RecipeVersion,
  StockMovement,
} from './types';

export interface RecipeConsumptionResult {
  recipe_version_id: string;
  portionsSold: number;
  totalCogs: number;
  ingredientConsumptions: Record<string, FifoConsumptionResult>;
  updatedBatches: InventoryBatch[];
  movements: StockMovement[];
}

export class FifoCostCalculator {
  /**
   * Partileri FIFO kurallarına göre (en eski ilk) artan kronolojik sırada sıralar.
   */
  public static sortBatchesFifo(batches: InventoryBatch[]): InventoryBatch[] {
    return [...batches].sort((a, b) => {
      const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Aktif envanter partilerinde FIFO yöntemini kullanarak tek bir malzeme için stoğu tüketir.
   * Tahsisleri, toplam harmanlanmış COGS'yi, (varsa) kalan açığı ve güncellenmiş parti durumunu döndürür.
   */
  public static consumeStock(
    allBatches: InventoryBatch[],
    ingredientId: string,
    quantityToConsume: number
  ): FifoConsumptionResult {
    if (quantityToConsume <= 0) {
      return {
        ingredientId,
        requestedQuantity: quantityToConsume,
        consumedQuantity: 0,
        totalCogs: 0,
        blendedUnitCost: 0,
        allocations: [],
        remainingDeficit: 0,
        updatedBatches: allBatches.map((b) => ({ ...b })),
      };
    }

    // Clone all batches to preserve immutability
    const batchCopies: InventoryBatch[] = allBatches.map((b) => ({ ...b }));

    // Bu malzeme için ilgili partileri çıkarın ve sıralayın
    const now = new Date().getTime();
    const eligibleBatches = FifoCostCalculator.sortBatchesFifo(
      batchCopies.filter(
        (b) =>
          b.ingredientId === ingredientId &&
          b.remainingQuantity > 0 &&
          (!b.expirationDate || new Date(b.expirationDate).getTime() > now)
      )
    );

    let needed = quantityToConsume;
    let totalCogs = 0;
    const allocations: FifoAllocation[] = [];

    for (const batch of eligibleBatches) {
      if (needed <= 0) break;

      const takeQty = Math.min(batch.remainingQuantity, needed);
      const allocationCost = Math.round(takeQty * batch.unitCost * 10000) / 10000;

      // Tam kopyalanmış dizide kalan parti miktarını güncelleyin
    const targetInCopies = batchCopies.find((b) => b.id === batch.id);
      if (targetInCopies) {
        targetInCopies.remainingQuantity =
          Math.round((targetInCopies.remainingQuantity - takeQty) * 10000) / 10000;
      }

      allocations.push({
        batchId: batch.id,
        quantity: takeQty,
        unitCost: batch.unitCost,
        totalCost: allocationCost,
      });

      totalCogs += allocationCost;
      needed = Math.round((needed - takeQty) * 10000) / 10000;
    }

    const consumedQuantity = Math.round((quantityToConsume - needed) * 10000) / 10000;
    const blendedUnitCost =
      consumedQuantity > 0 ? Math.round((totalCogs / consumedQuantity) * 10000) / 10000 : 0;

    return {
      ingredientId,
      requestedQuantity: quantityToConsume,
      consumedQuantity,
      totalCogs: Math.round(totalCogs * 10000) / 10000,
      blendedUnitCost,
      allocations,
      remainingDeficit: Math.max(0, needed),
      updatedBatches: batchCopies,
    };
  }

  /**
   * Belirli bir porsiyon sayısı için satılan kesin bir RecipeVersion'a dayalı olarak envanteri tüketir.
   * Tüm malzemeler genelinde kesin harmanlanmış COGS'yi hesaplar.
   */
  public static consumeRecipe(
    currentBatches: InventoryBatch[],
    recipeVersion: RecipeVersion,
    portionsSold: number,
    referenceOrderId?: string,
    timestamp: string = new Date().toISOString()
  ): RecipeConsumptionResult {
    if (portionsSold <= 0) {
      throw new Error('Portions sold must be greater than zero.');
    }

    let workingBatches: InventoryBatch[] = currentBatches.map((b) => ({ ...b }));
    let aggregateCogs = 0;
    const ingredientConsumptions: Record<string, FifoConsumptionResult> = {};
    const movements: StockMovement[] = [];

    for (const ingredient of recipeVersion.ingredients) {
      // Scale ingredient by portions sold and recipe yield
      const totalIngredientQuantity =
        Math.round(((ingredient.quantity * portionsSold) / recipeVersion.yieldQuantity) * 10000) /
        10000;

      const consumption = FifoCostCalculator.consumeStock(
        workingBatches,
        ingredient.ingredientId,
        totalIngredientQuantity
      );

      workingBatches = consumption.updatedBatches;
      ingredientConsumptions[ingredient.ingredientId] = consumption;
      aggregateCogs += consumption.totalCogs;

      for (const alloc of consumption.allocations) {
        movements.push({
          id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          ingredientId: ingredient.ingredientId,
          type: 'SALE_CONSUMPTION',
          quantity: -alloc.quantity,
          unitCost: alloc.unitCost,
          totalCost: alloc.totalCost,
          batchId: alloc.batchId,
          recipe_version_id: recipeVersion.recipe_version_id,
          referenceId: referenceOrderId,
          timestamp,
          reason: `Sale consumption: ${portionsSold} portions of recipe ${recipeVersion.recipeId} (v${recipeVersion.versionNumber})`,
        });
      }
    }

    return {
      recipe_version_id: recipeVersion.recipe_version_id,
      portionsSold,
      totalCogs: Math.round(aggregateCogs * 10000) / 10000,
      ingredientConsumptions,
      updatedBatches: workingBatches,
      movements,
    };
  }

  /**
   * Kalan envanterin toplam mevcut değerini ve ortalama birim maliyetlerini hesaplar.
   */
  public static calculateInventoryValuation(batches: InventoryBatch[]): {
    totalValuation: number;
    totalUnits: number;
    perIngredient: Record<
      string,
      { totalUnits: number; totalValuation: number; averageUnitCost: number }
    >;
  } {
    let totalValuation = 0;
    let totalUnits = 0;
    const perIngredient: Record<
      string,
      { totalUnits: number; totalValuation: number; averageUnitCost: number }
    > = {};

    for (const batch of batches) {
      if (batch.remainingQuantity <= 0) continue;

      const batchValue = Math.round(batch.remainingQuantity * batch.unitCost * 10000) / 10000;
      totalValuation += batchValue;
      totalUnits += batch.remainingQuantity;

      if (!perIngredient[batch.ingredientId]) {
        perIngredient[batch.ingredientId] = {
          totalUnits: 0,
          totalValuation: 0,
          averageUnitCost: 0,
        };
      }

      perIngredient[batch.ingredientId].totalUnits += batch.remainingQuantity;
      perIngredient[batch.ingredientId].totalValuation += batchValue;
    }

    for (const key of Object.keys(perIngredient)) {
      const item = perIngredient[key];
      item.totalUnits = Math.round(item.totalUnits * 10000) / 10000;
      item.totalValuation = Math.round(item.totalValuation * 10000) / 10000;
      item.averageUnitCost =
        item.totalUnits > 0
          ? Math.round((item.totalValuation / item.totalUnits) * 10000) / 10000
          : 0;
    }

    return {
      totalValuation: Math.round(totalValuation * 10000) / 10000,
      totalUnits: Math.round(totalUnits * 10000) / 10000,
      perIngredient,
    };
  }
}
