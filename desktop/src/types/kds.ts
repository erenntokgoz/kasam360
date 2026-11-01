export type KdsItemStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';

export interface KdsTicketItem {
  id: string;
  orderItemId: string;
  productName: string;
  quantity: number;
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
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
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
  createdAt: string;
  elapsedMinutes: number;
  items: KdsTicketItem[];
}
