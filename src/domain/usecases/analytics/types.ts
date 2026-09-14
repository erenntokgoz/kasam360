export type OperationalEventType =
  | 'SALE'
  | 'REFUND'
  | 'CANCELLATION'
  | 'VOID'
  | 'DISCOUNT'
  | 'WASTE'
  | 'RECEIVING_COST'
  | 'LABOR_COST'
  | 'OVERHEAD_COST';

export interface OperationalEvent {
  id: string;
  type: OperationalEventType;
  timestamp: string; // ISO 8601 string
  amount: number; // Parasal miktar veya doğrudan finansal değer
  quantity?: number;
  entityId?: string; // Sipariş ID, Ürün ID, Personel ID, Malzeme ID vb.
  entityName?: string;
  category?: string; // örn. 'Kümes Hayvanları', 'Et', 'Süt Ürünleri', 'Sebze Meyve', 'İçecek', 'Paketleme'
  metadata?: {
    isOffHours?: boolean;
    reason?: string;
    staffId?: string;
    managerId?: string;
    discountRate?: number;
    channel?: string;
    orderId?: string;
    tableId?: string | number;
    voidReason?: string;
    recipeVersionId?: string;
    [key: string]: unknown;
  };
}

export type MetricStreamType =
  | 'REVENUE_VELOCITY'
  | 'FOOD_COST_RATIO'
  | 'CANCELLATION_FREQUENCY'
  | 'REFUND_VOLUME'
  | 'DISCOUNT_RATE'
  | 'VOID_FREQUENCY'
  | 'CUSTOM';

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

export interface MetricWindow {
  streamType: MetricStreamType;
  windowSize: number;
  dataPoints: MetricDataPoint[];
  currentValue: number;
  mean: number; // Kayan pencere hareketli ortalama
  standardDeviation: number; // Örneklem standart sapması
  variance: number;
  min: number;
  max: number;
  zScore?: number;
  timestamp: string;
}

export type AnomalySeverity = 'NORMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AnomalyDetectionMethod = 'VARIANCE_BASED' | 'RULE_BASED' | 'HYBRID';

export type AnomalyType =
  | 'SUDDEN_REVENUE_DROP'
  | 'REVENUE_VELOCITY_SPIKE'
  | 'FOOD_COST_SURGE'
  | 'UNCHARACTERISTIC_CANCELLATION_SPIKE'
  | 'REFUND_VOLUME_SURGE'
  | 'OFF_HOURS_DISCOUNT_SPIKE'
  | 'ERRATIC_ITEM_VOID'
  | 'UNAUTHORIZED_DISCOUNT_LEAK'
  | 'HIGH_VARIANCE_OUTLIER';

export interface AnomalyScore {
  id: string;
  metric: MetricStreamType | string;
  method: AnomalyDetectionMethod;
  type: AnomalyType;
  severity: AnomalySeverity;
  score: number; // Normalleştirilmiş anomali puanı (0.0 - 100.0)
  zScore: number; // Hareketli ortalamadan standart sapmalar
  isAnomaly: boolean;
  currentValue: number;
  expectedValue: number; // Temel / hareketli ortalama
  deviation: number; // Fark (currentValue - expectedValue)
  deviationPercentage: number; // Yüzdelik delta
  reason: string;
  timestamp: string;
  context?: Record<string, unknown>;
  associatedEventIds?: string[];
}

export type FactorialCategory =
  | 'COGS_VARIANCE'
  | 'WASTE_DEVIATION'
  | 'DISCOUNT_LEAKAGE'
  | 'CANCELLATION_LOSS'
  | 'REFUND_IMPACT'
  | 'VOID_IMPACT'
  | 'REVENUE_VOLUME'
  | 'LABOR_OVERTIME'
  | 'OVERHEAD';

export interface FactorialDriver {
  factor: string; // örn. "Kümes hayvanları maliyet varyansı", "Atık sapması"
  category: FactorialCategory;
  impactAmount: number; // Net kar üzerindeki parasal etki
  baselineValue: number; // Temel finansal değer
  currentValue: number; // Mevcut finansal değer
  varianceAmount: number; // currentValue - baselineValue
  variancePercentage: number; // örn. +12.4% göreceli varyans
  varianceSharePercentage: number; // Toplam varyansa katkı payı
  evidence: string[]; // Bulguyu destekleyen yapılandırılmış veri noktaları
  subDrivers?: FactorialDriver[]; // Ayrıntılı alt kategori sürücüleri
}

export interface RootCauseSourceDataSummary {
  baselineRevenue: number;
  currentRevenue: number;
  baselineCogs: number;
  currentCogs: number;
  baselineWaste: number;
  currentWaste: number;
  baselineDiscounts: number;
  currentDiscounts: number;
  baselineRefunds: number;
  currentRefunds: number;
  baselineCancellations: number;
  currentCancellations: number;
  eventsAnalyzedCount: number;
  [key: string]: unknown;
}

export interface RootCauseInsight {
  id: string;
  query: string; // örn. "Net kar bu ay neden düştü?"
  periodStart: string;
  periodEnd: string;
  baselineStart: string;
  baselineEnd: string;
  headline: string; // Structured factorial explanation summary
  targetMetric: 'NET_PROFIT' | 'REVENUE' | 'FOOD_COST' | string;
  baselineProfit: number;
  currentProfit: number;
  netVariance: number;
  netVariancePercentage: number;
  primaryDriver: FactorialDriver;
  contributingFactors: FactorialDriver[];
  actionableRecommendations: string[];
  sourceDataSummary: RootCauseSourceDataSummary;
  createdAt: string;
}
