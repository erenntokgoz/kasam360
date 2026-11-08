export interface CashMovement {
  id: string;
  shiftId: string;
  type: 'IN' | 'OUT';
  amountCents: number;
  reason: string;
  authorizedBy: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  tenantId: string;
  cashierId: string;
  cashierName: string;
  openingCashCents: number;
  closingCashCents?: number;
  expectedCashCents?: number;
  cashDifferenceCents?: number;
  openedAt: string;
  closedAt?: string;
  isOpen: boolean;
  notes?: string;
}

export interface ShiftSummary {
  shiftId: string;
  cashierName: string;
  openedAt: string;
  openingCashCents: number;
  totalCashSalesCents: number | null;
  totalCardSalesCents: number;
  totalMealCardSalesCents: number;
  totalVeresiyeCents: number;
  totalCashInCents: number;
  totalCashOutCents: number;
  expectedCashInDrawerCents: number | null;
  totalSalesCents: number | null;
}

export interface ZReportData {
  reportNumber: string;
  tenantName: string;
  taxNumber: string | null;
  shiftId: string;
  cashierName: string | null;
  openingCashCents: number;
  countedCashCents: number;
  expectedCashCents: number;
  differenceCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  mealCardSalesCents: number;
  veresiyeSalesCents: number;
  totalRevenueCents: number;
  totalVatCents: number;
  voidTotalCents: number;
  refundTotalCents: number;
  discountTotalCents: number;
  compTotalCents: number;
  cashInCents: number;
  cashOutCents: number;
  orderCount: number;
  closedAt: string;
}
