export interface ProductCategory {
  id: string;
  name: string;
  icon?: string;
  orderIndex: number;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  unitPriceCents: number;
  vatRate: number; // örn: 10 (%10)
  taxRateBp?: number;
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
  isAvailable: boolean;
  is86d?: boolean;
  modifierGroups?: ModifierGroup[];
  barcode?: string;
}

export interface OrderItemModifier {
  optionId: string;
  name: string;
  priceDeltaCents: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
  notes?: string;
  cookingDegree?: string;
  selectedModifiers: OrderItemModifier[];
  totalCents: number;
  isSentToKitchen: boolean;
  isComp?: boolean;
  isVoid?: boolean;
  taxRateBp?: number;
  // Sunucu satırının bütünü: adet payı bunlardan kuruş kaybetmeden türetilir.
  lineQuantity?: number;
  paidQuantity?: number;
  lineTotalCents?: number;
}

export interface Order {
  id: string;
  tenantId: string;
  tableId?: string;
  isWalkin: boolean;
  status: 'OPEN' | 'BILL_PRINTED' | 'PAID' | 'VOID';
  items: OrderItem[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  guestCount?: number;
  createdAt: string;
  updatedAt: string;
}
