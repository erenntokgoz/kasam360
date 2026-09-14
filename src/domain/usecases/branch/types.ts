export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type BranchStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  currency: string;
  timezone: string;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  legalName?: string;
  taxNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  organizationId: string;
  code: string;
  name: string;
  address?: string;
  phone?: string;
  currency: string;
  timezone: string;
  isCentral: boolean;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantBranchContext {
  tenantId: string;
  branchId: string;
  userId: string;
  roles: string[];
  isCentralAdmin?: boolean;
  correlationId?: string;
}

export type StockTransferStatus =
  'DRAFT' | 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED' | 'ROLLED_BACK';

export type StockTransferPhase =
  'INITIATED' | 'OUT_DEDUCTED' | 'IN_TRANSIT' | 'IN_CREDITED' | 'COMMITTED' | 'ABORTED';

export interface StockTransferItem {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  sourceBatchId?: string;
  destinationBatchId?: string;
}

export interface StockTransferAuditEntry {
  timestamp: string;
  phase: StockTransferPhase;
  status: StockTransferStatus;
  userId: string;
  action: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface StockTransferTransaction {
  id: string;
  tenantId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  status: StockTransferStatus;
  phase: StockTransferPhase;
  items: StockTransferItem[];
  totalValue: number;
  initiatedBy: string;
  approvedBy?: string;
  receivedBy?: string;
  trackingNumber?: string;
  notes?: string;
  rollbackReason?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  auditTrail: StockTransferAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface BranchInventoryBatch {
  id: string;
  tenantId: string;
  branchId: string;
  ingredientId: string;
  receivedAt: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  unit: string;
  batchNumber?: string;
  supplierId?: string;
  expirationDate?: string | null;
}

export interface StockTransferRequest {
  sourceBranchId: string;
  destinationBranchId: string;
  items: Array<{
    ingredientId: string;
    ingredientName?: string;
    quantity: number;
    unit: string;
  }>;
  initiatedBy: string;
  notes?: string;
}

export interface StockTransferExecutionResult {
  success: boolean;
  transaction: StockTransferTransaction;
  sourceUpdatedBatches: BranchInventoryBatch[];
  destinationUpdatedBatches: BranchInventoryBatch[];
  error?: string;
}

export interface BranchFinancialMetrics {
  branchId: string;
  branchName: string;
  currency: string;
  grossRevenue: number;
  netRevenue: number;
  cogs: number;
  foodCostPercentage: number;
  operatingExpenses: number;
  netProfit: number;
  netProfitMarginPercentage: number;
  ordersCount: number;
  averageOrderValue: number;
  stockTransfersOutValue: number;
  stockTransfersInValue: number;
  inventoryValuation: number;
}

export interface OwnerDashboardMetrics {
  totalRevenue: number;
  totalNetRevenue: number;
  revenueVelocityPerHour: number;
  totalCogs: number;
  blendedFoodCostPercentage: number;
  grossProfit: number;
  grossProfitMarginPercentage: number;
  totalOperatingExpenses: number;
  netProfit: number;
  netProfitMarginPercentage: number;
  totalOrdersCount: number;
  averageOrderValue: number;
  activeBranchesCount: number;
  topPerformingBranchId: string;
  lowestFoodCostBranchId: string;
  mostProfitableBranchId: string;
}

export interface BranchReportingPeriod {
  startDate: string;
  endDate: string;
  durationHours: number;
}

export interface ConsolidatedReport {
  reportId: string;
  tenantId: string;
  period: BranchReportingPeriod;
  currency: string;
  generatedAt: string;
  summary: OwnerDashboardMetrics;
  branchBreakdowns: Record<string, BranchFinancialMetrics>;
  branchRankings: {
    byRevenue: string[];
    byNetProfit: string[];
    byFoodCostEfficiency: string[];
  };
  anomalies: string[];
}

export interface ScopedQuery<T = Record<string, unknown>> {
  tenantId: string;
  branchId: string;
  filter: T;
}

export interface ScopedEvent<T = unknown> {
  eventId: string;
  eventType: string;
  tenantId: string;
  branchId: string;
  userId: string;
  timestamp: string;
  correlationId?: string;
  payload: T;
}
