export type PaymentMethod = 'CASH' | 'CARD' | 'MEAL_CARD' | 'VERESIYE';

export type PaymentSplitMode = 'FULL' | 'ITEMS' | 'PARTIAL';

export interface SplitItemSelection {
  orderItemId: string;
  selectedQty: number;
  unitPriceCents: number;
}

export interface ProcessPaymentPayload {
  orderId: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
  splitMode: PaymentSplitMode;
  splitItems?: SplitItemSelection[];
  discountCents?: number;
  directoryId?: string; // Veresiye (Cari) seçildiyse müşteri kimliği
  cashierId: string;
}

export interface PaymentResult {
  paymentId: string;
  orderId: string;
  amountPaidCents: number;
  remainingOrderCents: number;
  isOrderClosed: boolean;
  receiptNumber: string;
  printedReceiptText?: string;
}
