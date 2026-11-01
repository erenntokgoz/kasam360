export type TableStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'BILL_REQUESTED';

export interface FloorZone {
  id: string;
  name: string;
  tableCount: number;
}

export interface TableItemSummary {
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** Parça ödeme sonrası masada kalan tutar. */
  remainingCents?: number;
  notes?: string;
}

export interface FloorTable {
  id: string;
  tableNumber: string;
  zoneId: string;
  zoneName: string;
  capacity: number;
  status: TableStatus;
  occupiedSeats?: number;
  activeOrderId?: string;
  totalCents: number;
  /** Parça ödeme sonrası masada kalan tutar. */
  remainingCents?: number;
  openedAt?: string;
  waiterName?: string;
  reservedAt?: string;
  customerName?: string;
  reservationId?: string;
  // Kroki koordinatları (2D blueprint geometry)
  posX: number;
  posY: number;
  width: number;
  height: number;
  shape?: 'ROUND' | 'RECT';
}

export interface Reservation {
  id: string;
  tableId: string;
  tableNumber: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  reservationTime: string;
  notes?: string;
  status: 'PENDING' | 'CONFIRMED' | 'ARRIVED' | 'CANCELLED';
}
