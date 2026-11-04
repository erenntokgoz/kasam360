export type DirectoryType = 'CUSTOMER' | 'SUPPLIER' | 'STAFF' | 'FIXED_EXPENSE' | 'OWNER_PERSONAL';

export interface DirectoryContact {
  id: string;
  tenantId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  taxNo?: string | null;
  taxOffice?: string | null;
  address?: string | null;
  type: DirectoryType;
  creditLimitCents: number;
  balanceCents: number; // Pozitif: Alacağımız var, Negatif: Borcumuz var
  notes?: string | null;
  createdAt: string;
}

export type PatronActionType = 'BORC' | 'ALACAK' | 'GELIR' | 'GIDER';

export interface LedgerDebt {
  id: string;
  tenantId: string;
  directoryId: string;
  directoryName: string | null;
  type: 'GIVEN' | 'TAKEN'; // GIVEN: Alacağımız, TAKEN: Borcumuz
  totalAmountCents: number;
  remainingAmountCents: number;
  dueDate?: string | null;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  isCash: boolean;
  orderId?: string | null;
  description?: string | null;
  createdAt: string;
  isOverdue: boolean;
  version: number;
  documentNo?: string | null;
  purchaseOrderId?: string | null;
}

export interface StatementLine {
  id: string;
  kind: 'BORC_ACILDI' | 'TAHSILAT' | 'TEDIYE' | 'IADE';
  signedAmountCents: number;
  description?: string | null;
  createdAt: string;
  balanceAfterCents: number;
  debtId: string;
  dueDate?: string | null;
  orderId?: string | null;
  documentNo?: string | null;
  purchaseOrderId?: string | null;
}

export interface DirectoryStatement {
  directoryId: string;
  directoryName: string;
  directoryType: DirectoryType;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalDebitCents: number;
  totalCreditCents: number;
  lines: StatementLine[];
  fromDate: string;
  toDate: string;
}

export interface AwaitingDocument {
  purchaseOrderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  directoryId?: string | null;
  receivedAt?: string | null;
  receivedTotalCents: number;
  paymentTermDays: number;
}

export interface OperationOutcome {
  operationId: string;
  status: 'APPLIED' | 'REJECTED' | 'PENDING' | 'UNKNOWN';
  error?: string | null;
}

export interface StaffProfile {
  id: string;
  userId: string;
  name: string;
  role: string;
  baseSalaryCents: number;
  advanceBalanceCents: number;
  monthlyCommissionCents: number;
  totalSalesCents: number;
  ordersServed: number;
}

export interface FinancialProfitSummary {
  totalRevenueCents: number;
  totalCogsCents: number;
  totalVatCents: number;
  totalRefundsCents: number;
  grossProfitCents: number;
  /** Partisiz düşülen kalem sayısı; sıfır değilse kâr yaklaşıktır. */
  costMissingLines: number;
  totalExpensesCents: number;
  netProfitCents: number;
  receivablesCents: number;
  payablesCents: number;
}
