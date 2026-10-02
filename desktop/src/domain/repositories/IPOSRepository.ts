import {
  POSProduct,
  PaymentPayload,
  PaymentResult,
  POSCategory,
  SubmitOrderPayload,
  VoidOrderPayload,
} from '../../presentation/types';

/**
 * Domain Abstract Repository Contract for POS Operations.
 * Enforces Clean Architecture boundary between UI state management and data/IPC persistence.
 */
export interface IPOSRepository {
  getProducts(category?: string, query?: string): Promise<POSProduct[]>;
  getProductById(id: string): Promise<POSProduct | null>;
  getProductByBarcode(barcode: string): Promise<POSProduct | null>;
  getCategories(): Promise<POSCategory[]>;
  getProductModifiers(productId: string): Promise<import('../../presentation/types').ModifierGroup[]>;
  processPayment(payload: PaymentPayload): Promise<PaymentResult>;
  processSplitPayment(payload: PaymentPayload): Promise<PaymentResult>;
  printReceipt(receiptId: string): Promise<void>;
  submitOrder(payload: SubmitOrderPayload): Promise<boolean>;
  voidOrder(payload: VoidOrderPayload): Promise<boolean>;
  getOrderItems(tableId: string): Promise<import('../../presentation/types').CartItem[]>;
}
