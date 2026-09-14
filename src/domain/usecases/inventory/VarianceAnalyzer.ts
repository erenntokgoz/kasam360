import { RecipeManager } from './RecipeManager';
import {
  CostVariance,
  PhysicalStockCount,
  ReceivingVarianceRecord,
  SaleConsumptionRecord,
  VarianceAnalysisReport,
  VarianceDeviationSeverity,
  WasteRecord,
} from './types';

export interface VarianceAnalyzerConfig {
  warningThresholdPercentage?: number; // örn. %5 sapma uyarı tetikler
  criticalThresholdPercentage?: number; // örn. %10 sapma kritik durum tetikler
  absoluteDollarAlertThreshold?: number; // örn. 100₺ sapma her halükarda uyarı tetikler
}

export interface VarianceAnalysisInput {
  periodStart: string;
  periodEnd: string;
  sales: SaleConsumptionRecord[];
  recipeManager: RecipeManager;
  actualFifoConsumptionCost?: number; // FIFO hesaplayıcısından gelen gerçek COGS (Satılan Malın Maliyeti)
  ingredientFifoCogs?: Record<string, number>; // Malzeme başına gerçek COGS
  wasteRecords?: WasteRecord[];
  stockCounts?: PhysicalStockCount[];
  receivingVariances?: ReceivingVarianceRecord[];
}

export class VarianceAnalyzer {
  private config: Required<VarianceAnalyzerConfig>;

  constructor(config?: VarianceAnalyzerConfig) {
    this.config = {
      warningThresholdPercentage: config?.warningThresholdPercentage ?? 5.0,
      criticalThresholdPercentage: config?.criticalThresholdPercentage ?? 10.0,
      absoluteDollarAlertThreshold: config?.absoluteDollarAlertThreshold ?? 50.0,
    };
  }

  /**
   * Sadece versiyonlanmış reçetelere ve satılan hacme dayalı olarak beklenen Teorik Gıda Maliyetini hesaplar.
   * Geçmişe dönük bütünlüğü garanti eder: Eğer bir satış recipe_version_id belirtiyorsa, o dondurulmuş versiyon değerlendirilir.
   */
  public calculateTheoreticalFoodCost(
    sales: SaleConsumptionRecord[],
    recipeManager: RecipeManager
  ): {
    totalTheoreticalCost: number;
    perIngredientTheoreticalCost: Record<string, { cost: number; quantity: number; name: string }>;
  } {
    let totalTheoreticalCost = 0;
    const perIngredient: Record<string, { cost: number; quantity: number; name: string }> = {};

    for (const sale of sales) {
      if (sale.quantitySold <= 0) continue;

      // Dondurulmuş reçete versiyonunu tam versiyon kimliğine (version ID) göre ara, bulunamazsa aktif reçete versiyonuna dön
      const version =
        recipeManager.getVersion(sale.recipe_version_id) ??
        recipeManager.getActiveVersion(sale.recipeId);

      if (!version) {
        throw new Error(
          `Cannot compute theoretical cost: Recipe version "${sale.recipe_version_id}" (recipe "${sale.recipeId}") not found.`
        );
      }

      const saleTheoreticalCost =
        Math.round(sale.quantitySold * version.theoreticalCostPerUnit * 10000) / 10000;
      totalTheoreticalCost += saleTheoreticalCost;

      for (const ing of version.ingredients) {
        const theoreticalIngQty = (ing.quantity * sale.quantitySold) / (version.yieldQuantity || 1);
        const theoreticalIngCost = theoreticalIngQty * ing.costPerUnit;

        if (!perIngredient[ing.ingredientId]) {
          perIngredient[ing.ingredientId] = {
            cost: 0,
            quantity: 0,
            name: ing.name,
          };
        }

        perIngredient[ing.ingredientId].quantity += theoreticalIngQty;
        perIngredient[ing.ingredientId].cost += theoreticalIngCost;
      }
    }

    for (const key of Object.keys(perIngredient)) {
      perIngredient[key].quantity = Math.round(perIngredient[key].quantity * 10000) / 10000;
      perIngredient[key].cost = Math.round(perIngredient[key].cost * 10000) / 10000;
    }

    return {
      totalTheoreticalCost: Math.round(totalTheoreticalCost * 10000) / 10000,
      perIngredientTheoreticalCost: perIngredient,
    };
  }

  /**
   * FIFO satış tüketimi, kaydedilen fire, fiziksel sayım eksik/fazla düzeltmeleri ve 
   * mal kabul fiyat sapmalarından elde edilen Gerçek Gıda Maliyetini hesaplar.
   */
  public calculateActualFoodCost(
    fifoCogsTotal: number,
    wasteRecords: WasteRecord[] = [],
    stockCounts: PhysicalStockCount[] = [],
    receivingVariances: ReceivingVarianceRecord[] = []
  ): {
    totalActualCost: number;
    wasteCost: number;
    shrinkageCost: number;
    receivingPriceVarianceCost: number;
  } {
    const wasteCost = wasteRecords.reduce(
      (sum, w) => sum + (w.totalCost || w.quantity * w.unitCost),
      0
    );

    // Fire/Eksiklik: beklenen miktar eksi sayılan miktar (pozitif değer eksik stoğu/kaybı temsil eder)
    const shrinkageCost = stockCounts.reduce((sum, count) => {
      const difference = count.expectedQuantity - count.countedQuantity;
      return sum + difference * count.unitCost;
    }, 0);

    const receivingPriceVarianceCost = receivingVariances.reduce(
      (sum, rec) =>
        sum +
        (rec.totalPriceVariance ||
          rec.quantityReceived * (rec.invoicedUnitCost - rec.standardUnitCost)),
      0
    );

    const totalActualCost = fifoCogsTotal + wasteCost + shrinkageCost + receivingPriceVarianceCost;

    return {
      totalActualCost: Math.round(totalActualCost * 10000) / 10000,
      wasteCost: Math.round(wasteCost * 10000) / 10000,
      shrinkageCost: Math.round(shrinkageCost * 10000) / 10000,
      receivingPriceVarianceCost: Math.round(receivingPriceVarianceCost * 10000) / 10000,
    };
  }

  /**
   * Teorik ve gerçek gıda maliyetini analiz eder ve sapma uyarılarıyla birlikte karşılaştırmalı sapma metrikleri çıkarır.
   * Formül: Sapma = Gerçek Maliyet - Teorik Maliyet
   */
  public analyzeVariance(input: VarianceAnalysisInput): VarianceAnalysisReport {
    const theoretical = this.calculateTheoreticalFoodCost(input.sales, input.recipeManager);

    const wasteRecords = input.wasteRecords ?? [];
    const stockCounts = input.stockCounts ?? [];
    const receivingVariances = input.receivingVariances ?? [];
    const fifoConsumptionCost = input.actualFifoConsumptionCost ?? 0;

    const actual = this.calculateActualFoodCost(
      fifoConsumptionCost,
      wasteRecords,
      stockCounts,
      receivingVariances
    );

    const overallCostVariance = this.evaluateCostVariance(
      theoretical.totalTheoreticalCost,
      actual.totalActualCost,
      {
        theoreticalUsageCost: theoretical.totalTheoreticalCost,
        actualFifoConsumptionCost: fifoConsumptionCost,
        wasteCost: actual.wasteCost,
        inventoryShrinkageCost: actual.shrinkageCost,
        receivingPriceVariance: actual.receivingPriceVarianceCost,
      }
    );

    const ingredientVariances: Record<string, CostVariance> = {};
    const highDeviationAlerts: CostVariance[] = [];

    if (overallCostVariance.isAlert) {
      highDeviationAlerts.push(overallCostVariance);
    }

    const allIngredientIds = new Set<string>([
      ...Object.keys(theoretical.perIngredientTheoreticalCost),
      ...Object.keys(input.ingredientFifoCogs ?? {}),
      ...wasteRecords.map((w) => w.ingredientId),
      ...stockCounts.map((s) => s.ingredientId),
      ...receivingVariances.map((r) => r.ingredientId),
    ]);

    for (const ingId of allIngredientIds) {
      const theo = theoretical.perIngredientTheoreticalCost[ingId] ?? { cost: 0, name: ingId };
      const ingFifoCogs = input.ingredientFifoCogs?.[ingId] ?? 0;

      const ingWasteCost = wasteRecords
        .filter((w) => w.ingredientId === ingId)
        .reduce((sum, w) => sum + (w.totalCost || w.quantity * w.unitCost), 0);

      const ingShrinkageCost = stockCounts
        .filter((s) => s.ingredientId === ingId)
        .reduce((sum, s) => sum + (s.expectedQuantity - s.countedQuantity) * s.unitCost, 0);

      const ingRecVar = receivingVariances
        .filter((r) => r.ingredientId === ingId)
        .reduce(
          (sum, r) =>
            sum +
            (r.totalPriceVariance ||
              r.quantityReceived * (r.invoicedUnitCost - r.standardUnitCost)),
          0
        );

      const ingActualCost = ingFifoCogs + ingWasteCost + ingShrinkageCost + ingRecVar;

      const varianceItem = this.evaluateCostVariance(
        theo.cost,
        ingActualCost,
        {
          theoreticalUsageCost: theo.cost,
          actualFifoConsumptionCost: ingFifoCogs,
          wasteCost: ingWasteCost,
          inventoryShrinkageCost: ingShrinkageCost,
          receivingPriceVariance: ingRecVar,
        },
        ingId,
        theo.name
      );

      ingredientVariances[ingId] = varianceItem;
      if (varianceItem.isAlert) {
        highDeviationAlerts.push(varianceItem);
      }
    }

    return {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      overallVariance: overallCostVariance,
      ingredientVariances,
      highDeviationAlerts,
    };
  }

  private evaluateCostVariance(
    theoreticalCost: number,
    actualCost: number,
    breakdown: CostVariance['breakdown'],
    ingredientId?: string,
    ingredientName?: string
  ): CostVariance {
    const variance = Math.round((actualCost - theoreticalCost) * 10000) / 10000;
    const variancePercentage =
      theoreticalCost !== 0
        ? Math.round(((actualCost - theoreticalCost) / theoreticalCost) * 10000) / 100
        : actualCost !== 0
          ? 100
          : 0;

    let severity: VarianceDeviationSeverity = 'NORMAL';
    const absPercentage = Math.abs(variancePercentage);
    const absVariance = Math.abs(variance);

    if (
      absPercentage >= this.config.criticalThresholdPercentage ||
      absVariance >= this.config.absoluteDollarAlertThreshold * 2
    ) {
      severity = 'CRITICAL';
    } else if (
      absPercentage >= this.config.warningThresholdPercentage ||
      absVariance >= this.config.absoluteDollarAlertThreshold
    ) {
      severity = 'WARNING';
    }

    const isAlert = severity !== 'NORMAL';

    return {
      ingredientId,
      ingredientName,
      theoreticalCost: Math.round(theoreticalCost * 10000) / 10000,
      actualCost: Math.round(actualCost * 10000) / 10000,
      variance,
      variancePercentage,
      isAlert,
      severity,
      breakdown: {
        theoreticalUsageCost: Math.round(breakdown.theoreticalUsageCost * 10000) / 10000,
        actualFifoConsumptionCost: Math.round(breakdown.actualFifoConsumptionCost * 10000) / 10000,
        wasteCost: Math.round(breakdown.wasteCost * 10000) / 10000,
        inventoryShrinkageCost: Math.round(breakdown.inventoryShrinkageCost * 10000) / 10000,
        receivingPriceVariance: Math.round(breakdown.receivingPriceVariance * 10000) / 10000,
      },
    };
  }
}
