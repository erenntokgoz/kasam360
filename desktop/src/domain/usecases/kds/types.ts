export type StationType = 'Grill' | 'Fryer' | 'Pizza' | 'Bar' | 'Prep';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  category?: string;
  productType?: string;
  station?: StationType;
  complexityWeight?: number;
  modifiers?: string[];
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber?: string | number;
  tableNumber?: string | number;
  items: OrderItem[];
  createdAt: Date | string | number;
  priority?: 'NORMAL' | 'VIP' | 'RUSH' | number;
}

export interface LoadMetrics {
  station: StationType;
  activeOrdersCount: number;
  totalItemsCount: number;
  cumulativeComplexity: number;
  maxCapacity: number;
  loadPercentage: number;
  formattedLoad: string;
  isBottleneck: boolean;
}

export interface BottleneckWarning {
  station: StationType;
  currentLoadPercentage: number;
  thresholdPercentage: number;
  formattedLoad: string;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: Date;
}

export type StationItemMap = Record<StationType, OrderItem[]>;

export interface KitchenLoadReport {
  totalKitchenLoad: number;
  stationMetrics: Record<StationType, LoadMetrics>;
  bottlenecks: BottleneckWarning[];
  timestamp: Date;
}
