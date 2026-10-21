export type KdsItemStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';

export interface KdsTicketItem {
  id: string;
  orderItemId: string;
  productName: string;
  quantity: number;
  course: 1 | 2 | 3;
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
  cookingDegree?: string;
  notes?: string;
  status: KdsItemStatus;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  ticketNumber: number;
  tableName: string;
  waiterName?: string;
  station: 'MUTFAK' | 'BAR' | 'TATLI' | 'KASA';
  createdAt: string;
  elapsedMinutes: number;
  items: KdsTicketItem[];
  isCompleted: boolean;
}
