export interface RecipeIngredient {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
}

export interface RecipeVersion {
  recipe_version_id: string;
  recipeId: string;
  versionNumber: number;
  ingredients: RecipeIngredient[];
  yieldQuantity: number;
  theoreticalCostPerUnit: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason?: string;
}

export interface Recipe {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  active_version_id: string;
  versions: RecipeVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryBatch {
  id: string;
  ingredientId: string;
  receivedAt: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  unit: string;
  supplierId?: string;
  batchNumber?: string;
  expirationDate?: string | null;
}

export type StockMovementType =
  'RECEIPT' | 'SALE_CONSUMPTION' | 'WASTE' | 'PHYSICAL_COUNT_ADJUSTMENT' | 'RETURN' | 'TRANSFER';

export interface StockMovement {
  id: string;
  ingredientId: string;
  type: StockMovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  batchId?: string;
  recipe_version_id?: string;
  referenceId?: string;
  timestamp: string;
  reason?: string;
}

export interface FifoAllocation {
  batchId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface FifoConsumptionResult {
  ingredientId: string;
  requestedQuantity: number;
  consumedQuantity: number;
  totalCogs: number;
  blendedUnitCost: number;
  allocations: FifoAllocation[];
  remainingDeficit: number;
  updatedBatches: InventoryBatch[];
}

export interface SaleConsumptionRecord {
  orderId: string;
  recipeId: string;
  recipe_version_id: string;
  quantitySold: number;
  timestamp: string;
}

export interface WasteRecord {
  id: string;
  ingredientId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reason: 'EXPIRED' | 'SPOILED' | 'PREP_ERROR' | 'SPILLAGE' | 'OTHER';
  timestamp: string;
}

export interface PhysicalStockCount {
  ingredientId: string;
  countedQuantity: number;
  expectedQuantity: number;
  unitCost: number;
  timestamp: string;
}

export interface ReceivingVarianceRecord {
  id: string;
  ingredientId: string;
  quantityReceived: number;
  invoicedUnitCost: number;
  standardUnitCost: number;
  priceVariance: number;
  totalPriceVariance: number;
  timestamp: string;
}

export type VarianceDeviationSeverity = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface CostVariance {
  ingredientId?: string;
  ingredientName?: string;
  theoreticalCost: number;
  actualCost: number;
  variance: number;
  variancePercentage: number;
  isAlert: boolean;
  severity: VarianceDeviationSeverity;
  breakdown: {
    theoreticalUsageCost: number;
    actualFifoConsumptionCost: number;
    wasteCost: number;
    inventoryShrinkageCost: number;
    receivingPriceVariance: number;
  };
}

export interface VarianceAnalysisReport {
  periodStart: string;
  periodEnd: string;
  overallVariance: CostVariance;
  ingredientVariances: Record<string, CostVariance>;
  highDeviationAlerts: CostVariance[];
}
