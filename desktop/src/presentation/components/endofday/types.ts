// Günlük ciro ve ödeme yöntemleri dağılımı veri modeli (kuruş cinsinden)
export interface DailySummaryDto {
  total_revenue_cents: number;
  total_orders: number;
  payment_methods: Record<string, number>;
}

// Açık vardiya ve kasa durumu veri modeli
export interface OpenShiftDto {
  id: string;
  cashierId?: string;
  cashier_id?: string;
  cashierName?: string;
  cashier_name?: string;
  openedAt?: string;
  opened_at?: string;
  openingBalance?: number;
  expected_amount_cents?: number;
  cashSalesCents?: number;
  cashInCents?: number;
  cashOutCents?: number;
}

// Geçmiş kapatılmış vardiya ve Z-raporu kayıt modeli
export interface ShiftHistoryDto {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  cashierId?: string;
  cashier_id?: string;
  cashierName?: string;
  cashier_name?: string;
  status: string;
  openedAt?: string;
  opened_at?: string;
  closedAt?: string | null;
  closed_at?: string | null;
  expectedAmountCents?: number;
  expected_amount_cents?: number;
  actualAmountCents?: number | null;
  actual_amount_cents?: number | null;
  differenceCents?: number | null;
  difference_cents?: number | null;
  cashSalesCents?: number;
  cashInCents?: number;
  cashOutCents?: number;
}

// Gün sonu defter kapatma işlem yanıtı
export interface CloseDayResultDto {
  success: boolean;
  message: string;
  closedShiftsCount?: number;
  closed_shifts_count?: number;
  totalRevenueCents?: number;
  total_revenue_cents?: number;
  totalOrders?: number;
  total_orders?: number;
  closedAt?: string;
  closed_at?: string;
}

// Hesap Defteri ana sekme görünümleri
export type TabType = 'GUNUN_DEFTERI' | 'GECMIS_ARSIV' | 'CARI_REHBERLER' | 'BORC_ALACAK' | 'GIDER_DEFTERI' | 'FINANSAL_RAPORLAR';

// Bileşen parametreleri (SSR desteği ve test izolasyonu)
export interface EndOfDayContainerProps {
  initialLoading?: boolean;
  initialSummary?: DailySummaryDto;
  initialOpenShifts?: OpenShiftDto[];
  initialShiftHistory?: ShiftHistoryDto[];
}

// Vardiya çizelgesi satırı: kapanmış vardiya ile açık vardiya tek listede gösterilir.
// cashSalesCents kapanmış vardiyada sunucudan gelmediğinde null olabilir; 0 varsayılmaz.
export interface ShiftRow {
  shift: ShiftHistoryDto | OpenShiftDto;
  isOpen: boolean;
  cashSalesCents: number | null;
}
