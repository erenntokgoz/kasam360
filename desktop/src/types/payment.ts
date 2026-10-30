export type PaymentMethod = 'CASH' | 'CARD' | 'MEAL_CARD' | 'VERESIYE';

export type PaymentSplitMode = 'FULL' | 'ITEMS' | 'PARTIAL';

export interface PaymentResultWire {
  success: boolean;
  transactionId: string;
  fiscalReceiptNo?: string | null;
  remainingCents?: number;
  orderClosed?: boolean;
}

export interface PaymentStatusWire {
  processed: boolean;
  balance: { totalCents: number; paidCents: number; remainingCents: number };
}

/** Fiş önizlemesinin kaynağı: adisyon boşaldıktan sonra da gösterilir. */
export interface LastSale {
  transactionId: string;
  tableName: string;
  items: import('./pos').OrderItem[];
  amountCents: number;
  method: PaymentMethod;
  changeCents: number;
  remainingCents: number;
}
