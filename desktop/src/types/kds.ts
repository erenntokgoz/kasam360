export type KdsItemStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

export interface KdsTicketItem {
  id: string;
  orderItemId: string;
  productName: string;
  quantity: number;
  station: string;
  modifiers: string[];
  notes?: string;
  status: KdsItemStatus;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  ticketNumber: string;
  tableName: string;
  waiterName?: string;
  station: string;
  createdAt: string;
  elapsedMinutes: number;
  items: KdsTicketItem[];
}
