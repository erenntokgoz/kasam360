import type { ProductDto } from './menu360';

export interface StockBatch {
  id: string;
  productId: string;
  productName: string;
  stockUnit: string;
  remainingQuantity: number;
  unitCostCents: number;
  receivedAt: string;
  expiryDate: string | null;
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
  load: () => Promise<void>;
  createSupplier: (name: string) => Promise<boolean>;
  createOrder: (supplierId: string, orderNumber: string, items: StockOrderLineInput[]) => Promise<boolean>;
  receiveOrder: (orderId: string) => Promise<boolean>;
  quickReceive: (productId: string, quantity: number, unitCostCents: number) => Promise<boolean>;
}
