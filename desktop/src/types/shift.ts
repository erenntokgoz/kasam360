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
  totalCashSalesCents: number;
  totalCardSalesCents: number;
  totalMealCardSalesCents: number;
  totalVeresiyeCents: number;
  totalCashInCents: number;
  totalCashOutCents: number;
  expectedCashInDrawerCents: number;
  totalSalesCents: number;
}

export interface ZReportData {
  reportNumber: string;
  tenantName: string;
  taxNumber: string;
  dateStr: string;
  shiftId: string;
  cashierName: string;
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
  discountTotalCents: number;
  orderCount: number;
  closedAt: string;
}
