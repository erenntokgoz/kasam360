import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useRef } from 'react';
import { reportPeriod, RANGE_LABELS, type PanoramaRange } from '../../../lib/dateRange';
import { canAnimate, gsap, useGSAP } from '../../../lib/dashMotion';
import { formatMoney } from '../../../lib/formatMoney';
import { buildInsights } from '../../../lib/panoramaInsights';
import { useAuthStore } from '../../../stores/authStore';
import { currentMonth, usePanoramaStore } from '../../../stores/panoramaStore';
import { useUIStore } from '../../../stores/uiStore';
import { monthLabel } from '../../../ui/MonthPicker';
import { AlertFeed } from './AlertFeed';
import { KitchenQueue } from './KitchenQueue';
import { KpiStrip } from './KpiStrip';
import { LivePanel } from './LivePanel';
import { LowStock } from './LowStock';
import { MenuMatrix } from './MenuMatrix';
import { MonthlyGoal } from './MonthlyGoal';
import { Panel } from './Panel';
import { PeriodFilter } from './PeriodFilter';
import { PaymentMix } from './PaymentMix';
import { RevenueChart } from './RevenueChart';
import { TopProducts } from './TopProducts';

const REFRESH_MS = 30_000;

/** KPI etiketi seçili dönemi söyler: rakamlar her zaman bugünü göstermez. */
function periodName(range: PanoramaRange): string {
  if (typeof range === 'string') return RANGE_LABELS[range];
  if ('month' in range) return monthLabel(range.month);
  return 'Seçili dönem';
}

/** Patronun tek bakışta gördüğü pano. Her rakam kayıtlı hareketten gelir. */
export const BoardSection: React.FC = () => {
  const { range, data, metrics, metricsError, error, setRange, load } = usePanoramaStore();
  const isModuleOpen = useUIStore((state) => state.activeModule === 'ERP');
  const isLocked = useAuthStore((state) => state.isLocked);
  const isVisible = isModuleOpen && !isLocked;
  const selectedCalendarMonth = typeof range === 'object' && 'month' in range;
  const goalMonth = selectedCalendarMonth ? range.month : currentMonth();
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const hasData = data !== null;

  useEffect(() => {
    if (!isVisible) return undefined;
    void load();
    // Pencere arka plandayken ya da başka sekme açıkken veritabanı boşuna okunmaz.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [isVisible, load]);

  // Pano sekmesi gizli tutulur (display:none); kartlar her görünür oluşta bir kez sırayla belirir,
  // dönem değişince ya da 30 sn yenilemede yeniden oynamaz.
  useEffect(() => { if (!isVisible) entered.current = false; }, [isVisible]);
  useGSAP(() => {
    if (!hasData || !isVisible || entered.current) return;
    entered.current = true;
    if (!canAnimate()) return;
    gsap.from('.dash-card', { opacity: 0, y: 12, duration: 0.45, ease: 'power2.out', stagger: 0.06, clearProps: 'opacity,transform' });
  }, { scope: root, dependencies: [hasData, isVisible] });

  const compareLabel = reportPeriod(range).compareLabel;
  const hasSales = data ? data.current.collectedCents > 0 || data.current.orders > 0 || data.buckets.some((item) => item.currentCents > 0 || item.previousCents > 0) : false;
  const insights = data ? buildInsights(data, compareLabel) : [];

  const filter = <PeriodFilter range={range} onChange={setRange} />;

  const deductions = data ? (
    <Panel title="Dönem Kesintileri">
      <dl className="divide-y divide-[var(--border)]">
        {([
          ['Ödenecek KDV', data.current.vatCents],
          ['İndirim', data.current.discountCents],
          ['İptal', data.current.voidCents],
          ['İade', data.current.refundCents],
        ] as const).map(([label, amount]) => (
          <div key={label} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <dt className="text-[var(--text-secondary)]">{label}</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(amount)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  ) : null;

  return (
    <div ref={root} className="space-y-4">
      {error ? (
        <><p className="text-sm text-[var(--text-secondary)]">Pano okunamadı.</p><ErrorToast message={`Pano okunamadı: ${error}`} /></>
      ) : null}

      {data ? (
        <>
          {insights.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{insights.join(' ')}</p>
          ) : null}
          <KpiStrip current={data.current} previous={data.previous} compareLabel={compareLabel} periodName={periodName(range)} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <RevenueChart kind={data.bucketKind} buckets={data.buckets} toolbar={filter} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1 xl:grid-rows-[auto_1fr]">
              <MonthlyGoal month={goalMonth} rangeSelected={selectedCalendarMonth} />
              <LivePanel live={data.live} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <KitchenQueue live={data.live} />
            <LowStock alerts={data.alerts} />
            <PaymentMix channels={data.channels} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {hasSales ? (
              <>
                <div className="xl:col-span-5"><TopProducts products={data.products} showProfit={data.current.grossProfitCents !== null} /></div>
                <div className="xl:col-span-4"><MenuMatrix metrics={metrics} error={metricsError} /></div>
                <div className="xl:col-span-3">{deductions}</div>
              </>
            ) : null}
            <div className="xl:col-span-12"><AlertFeed alerts={data.alerts} /></div>
          </div>
        </>
      ) : (
        <>
          {!error ? <p className="text-sm text-[var(--text-secondary)]">Pano hazırlanıyor…</p> : null}
          <Panel title="Dönem">{filter}</Panel>
          {/* Hedef panodan bağımsız okunur; pano düşse de görünür kalır. */}
          <div className="max-w-md">
            <MonthlyGoal month={goalMonth} rangeSelected={selectedCalendarMonth} />
          </div>
        </>
      )}
    </div>
  );
};
