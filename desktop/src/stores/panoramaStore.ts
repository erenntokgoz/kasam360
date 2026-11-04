import { create } from 'zustand';
import { errorText } from '../lib/cariInput';
import { reportPeriod, utcOffsetMinutes, type RangeKey } from '../lib/dateRange';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';

export interface Kpi {
  collectedCents: number;
  orders: number;
  averageTicketCents: number;
  refundCents: number;
  discountCents: number;
  voidCents: number;
  vatCents: number;
  cogsCents: number | null;
  grossProfitCents: number | null;
  costIncomplete: boolean;
  /** Partisiz düşüm taşıyan tahsilat sayısı; sıfır değilse kâr yaklaşıktır. */
  costMissingSales: number;
}

export interface PanoramaBucket {
  label: string;
  currentCents: number;
  previousCents: number;
}

export interface PanoramaProduct {
  productId: string;
  name: string;
  units: number;
  revenueCents: number;
  profitCents: number | null;
}

export interface PanoramaAlert {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  target: string;
}

export interface PanoramaData {
  current: Kpi;
  previous: Kpi;
  bucketKind: 'HOUR' | 'DAY';
  buckets: PanoramaBucket[];
  channels: { channel: string; amountCents: number }[];
  products: PanoramaProduct[];
  live: {
    openTables: number;
    totalTables: number;
    openOrders: number;
    openOrderCents: number;
    longestOpenMinutes: number;
    kitchenWaiting: number;
    shiftOpen: boolean;
  };
  alerts: PanoramaAlert[];
}

export interface MenuMetrics {
  bcg_counts: { star: number; plowhorse: number; cash_cow: number; dog: number };
  bcg_matrix: { product_id: string; product_name: string; quadrant: string; units_sold: number; margin_percent: number | null }[];
  combinations: { product_a_name: string; product_b_name: string; support: number; confidence_percent: number }[];
}

export interface MonthlyTarget {
  month: string;
  category: string;
  target_cents: number;
  actual_cents: number;
  achieved_percent: number | null;
}

interface PanoramaStore {
  range: RangeKey;
  data: PanoramaData | null;
  metrics: MenuMetrics | null;
  /** Menü analizi ayrı okunur; hatası panonun geri kalanını düşürmez. */
  metricsError: string | null;
  error: string | null;
  loadedAt: Date | null;
  /** Bu ayın `ALL` hedefi. `undefined`: henüz okunmadı, `null`: hedef yok. */
  target: MonthlyTarget | null | undefined;
  targetError: string | null;
  setRange: (range: RangeKey) => void;
  load: () => Promise<void>;
  loadTarget: () => Promise<void>;
  saveTarget: (targetCents: number) => Promise<void>;
}

export const currentMonth = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const usePanoramaStore = create<PanoramaStore>((set, get) => ({
  range: 'TODAY',
  data: null,
  metrics: null,
  metricsError: null,
  error: null,
  loadedAt: null,
  target: undefined,
  targetError: null,

  setRange: (range) => {
    set({ range, data: null });
    void get().load();
  },

  // Okunamayan pano boş rakam göstermez: eski veri silinir, hata görünür.
  load: async () => {
    const { actorRole, tenantId } = sessionArgs();
    const requested = get().range;
    const period = reportPeriod(requested);
    const metricsCall = invokeIPC<MenuMetrics>('get_analytics_metrics', {
      tenantId,
      actorRole,
      range: { from: period.from.slice(0, 10), to: period.to.slice(0, 19).replace('T', ' ') },
      minSupport: 2,
    }).then(
      (metrics) => ({ metrics, metricsError: null }),
      (caught: unknown) => ({ metrics: null, metricsError: errorText(caught) }),
    );
    try {
      const data = await invokeIPC<PanoramaData>('get_panorama', {
        actorRole,
        tenantId,
        from: period.from,
        to: period.to,
        compareSeconds: period.compareSeconds,
        utcOffsetMinutes: utcOffsetMinutes(),
      });
      const menu = await metricsCall;
      if (get().range === requested) {
        set({ data, ...menu, error: null, loadedAt: new Date() });
      }
    } catch (caught) {
      set({ data: null, metrics: null, error: errorText(caught) });
    }
    // Hedef dönem seçiminden bağımsızdır; pano her yenilendiğinde o da tazelenir.
    void get().loadTarget();
  },

  // Hedef her zaman kasanın yerel ayıdır; Bugün/Dün seçimi hedefi değiştirmez.
  loadTarget: async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const rows = await invokeIPC<MonthlyTarget[]>('get_monthly_targets', {
        tenantId,
        actorRole,
        month: currentMonth(),
        utcOffsetMinutes: utcOffsetMinutes(),
      });
      set({ target: rows.find((item) => item.category === 'ALL') ?? null, targetError: null });
    } catch (caught) {
      set({ target: undefined, targetError: errorText(caught) });
    }
  },

  // Kaydetme hatası çağırana fırlatılır; panel onu gösterir.
  saveTarget: async (targetCents) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_monthly_target', {
      tenantId,
      actorRole,
      input: { month: currentMonth(), category: 'ALL', target_cents: targetCents },
    });
    await get().loadTarget();
  },
}));
