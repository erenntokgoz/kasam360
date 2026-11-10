import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect } from 'react';
import { reportPeriod } from '../../../lib/dateRange';
import { formatMoney } from '../../../lib/formatMoney';
import { buildInsights } from '../../../lib/panoramaInsights';
import { useAuthStore } from '../../../stores/authStore';
import { currentMonth, usePanoramaStore } from '../../../stores/panoramaStore';
import { useUIStore } from '../../../stores/uiStore';
import { AlertFeed } from './AlertFeed';
import { KpiStrip } from './KpiStrip';
import { LivePanel } from './LivePanel';
import { MenuMatrix } from './MenuMatrix';
import { MonthlyGoal } from './MonthlyGoal';
import { Panel } from './Panel';
import { PeriodFilter } from './PeriodFilter';
import { PaymentMix } from './PaymentMix';
import { RevenueChart } from './RevenueChart';
import { TopProducts } from './TopProducts';

const REFRESH_MS = 30_000;

/** Patronun tek bakışta gördüğü pano. Her rakam kayıtlı hareketten gelir. */
export const BoardSection: React.FC = () => {
  const { range, data, metrics, metricsError, error, setRange, load } = usePanoramaStore();
  const isModuleOpen = useUIStore((state) => state.activeModule === 'ERP');
  const isLocked = useAuthStore((state) => state.isLocked);
  const isVisible = isModuleOpen && !isLocked;
  const selectedCalendarMonth = typeof range === 'object' && 'month' in range;
  const goalMonth = selectedCalendarMonth ? range.month : currentMonth();

  useEffect(() => {
    if (!isVisible) return undefined;
    void load();
    // Pencere arka plandayken ya da başka sekme açıkken veritabanı boşuna okunmaz.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [isVisible, load]);

  const compareLabel = reportPeriod(range).compareLabel;
  const hasSales = data ? data.current.collectedCents > 0 || data.current.orders > 0 || data.buckets.some((item) => item.currentCents > 0 || item.previousCents > 0) : false;
  const insights = data ? buildInsights(data, compareLabel) : [];

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
    <div className="space-y-3">
      <PeriodFilter range={range} onChange={setRange} />

      {error ? (
        <><p className="text-sm text-[var(--text-secondary)]">Pano okunamadı.</p><ErrorToast message={`Pano okunamadı: ${error}`} /></>
      ) : null}

      {data ? (
        <>
          {insights.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{insights.join(' ')}</p>
          ) : null}
          <KpiStrip current={data.current} previous={data.previous} compareLabel={compareLabel} />
          {hasSales ? (
            <>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                <div className="xl:col-span-8">
                  <RevenueChart kind={data.bucketKind} buckets={data.buckets} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
                  <PaymentMix channels={data.channels} />
                  {deductions}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                <div className="xl:col-span-5"><TopProducts products={data.products} showProfit={data.current.grossProfitCents !== null} /></div>
                <div className="xl:col-span-4"><MenuMatrix metrics={metrics} error={metricsError} /></div>
                <div className="xl:col-span-3"><LivePanel live={data.live} /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <AlertFeed alerts={data.alerts} />
                <MonthlyGoal month={goalMonth} rangeSelected={selectedCalendarMonth} />
              </div>
            </>
          ) : (
            <>
              <p role="status" className="paper rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                Bu dönemde tahsilat ve kapanan satış yok.
              </p>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                <LivePanel live={data.live} />
                <AlertFeed alerts={data.alerts} />
                <MonthlyGoal month={goalMonth} rangeSelected={selectedCalendarMonth} />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {!error ? <p className="text-sm text-[var(--text-secondary)]">Pano hazırlanıyor…</p> : null}
          {/* Hedef panodan bağımsız okunur; pano düşse de görünür kalır. */}
          <div className="max-w-md">
            <MonthlyGoal month={goalMonth} rangeSelected={selectedCalendarMonth} />
          </div>
        </>
      )}
    </div>
  );
};
