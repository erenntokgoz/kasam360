import type { ProductDto } from './menu';

export interface StockBatch {
  id: string;
  productId: string;
  productName: string;
  stockUnit: string;
  remainingQuantity: number;
  unitCostCents: number;
  receivedAt: string;
  expiryDate: string | null;
  /** Adetle alınan partide bir adetten çıkan kullanılabilir gram. */
  usableGramsPerUnit: number | null;
}

export interface StockSupplier {
  id: string;
  name: string;
}

export interface StockPurchaseOrder {
  id: string;
  supplierId: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  productIds: string[];
}

/** Vadeli alımda borç açılır; peşinde borç aynı işlemde bu kanaldan ödenir. */
export type Settlement = 'TERM' | 'CASH' | 'CREDIT_CARD' | 'BANK_TRANSFER';

export interface ReceiptInput {
  settlement: Settlement;
  dueDate: string | null;
  documentNo: string | null;
  usableGrams: { productId: string; usableGramsPerUnit: number }[];
}

export interface StockOrderLineInput {
  productId: string;
  quantity: number;
  unitCostCents: number;
}

export interface StockState {
  products: ProductDto[];
  batches: StockBatch[];
  suppliers: StockSupplier[];
  orders: StockPurchaseOrder[];
  busy: boolean;
  error: string | null;
  pendingQuickReceipt: { orderId: string; tenantId: string; productId: string; quantity: number; unitCostCents: number; supplierId: string } | null;
  /** Sonucu bilinmeyen teslimin işlem kimliği; aynı seçimle yeniden denemede değişmez. */
  receiptAttempt: { key: string; operationId: string } | null;
  load: () => Promise<void>;
  createSupplier: (name: string, onCreated?: (supplier: StockSupplier) => void) => Promise<boolean>;
  createOrder: (supplierId: string, orderNumber: string, items: StockOrderLineInput[], onCreated?: (order: StockPurchaseOrder) => void) => Promise<boolean>;
  receiveOrder: (orderId: string, receipt: ReceiptInput) => Promise<boolean>;
  quickReceive: (productId: string, quantity: number, unitCostCents: number, supplierId: string, receipt: ReceiptInput) => Promise<boolean>;
}
