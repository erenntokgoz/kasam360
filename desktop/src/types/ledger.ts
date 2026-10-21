export type DirectoryType = 'CUSTOMER' | 'SUPPLIER' | 'STAFF' | 'OTHER';

export interface DirectoryContact {
  id: string;
  tenantId: string;
  name: string;
  phone?: string;
  type: DirectoryType;
  balanceCents: number; // Pozitif: Alacağımız var, Negatif: Borcumuz var
  notes?: string;
}

export type PatronActionType = 'BORC' | 'ALACAK' | 'GELIR' | 'GIDER';

export interface LedgerDebt {
  id: string;
  directoryId: string;
  directoryName: string;
  debtType: 'RECEIVABLE' | 'PAYABLE'; // RECEIVABLE: Alacak, PAYABLE: Borç
  amountCents: number;
  remainingCents: number;
  dueDate?: string;
  description: string;
  createdAt: string;
  isPaid: boolean;
}

export interface LedgerExpense {
  id: string;
  category: string;
  amountCents: number;
  paymentMethod: 'CASH' | 'CARD';
  description: string;
  createdAt: string;
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
  grossSalesCents: number;
  fifoCostOfGoodsCents: number; // Gerçek FIFO reçete maliyeti
  grossProfitCents: number;
  operatingExpensesCents: number;
  netProfitCents: number;
  totalReceivablesCents: number; // Dışarıdaki alacaklar
  totalPayablesCents: number; // Tedarikçiye borçlar
  cashInDrawerCents: number;
}
