import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect } from 'react';
import { reportPeriod } from '../../../lib/dateRange';
import { formatMoney } from '../../../lib/formatMoney';
import { buildInsights } from '../../../lib/panoramaInsights';
import { useAuthStore } from '../../../stores/authStore';
import { usePanoramaStore } from '../../../stores/panoramaStore';
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
  const insights = data ? buildInsights(data, compareLabel) : [];

  return (
    <div className="space-y-4">
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
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <RevenueChart kind={data.bucketKind} buckets={data.buckets} />
            </div>
            <PaymentMix channels={data.channels} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <TopProducts products={data.products} showProfit={data.current.grossProfitCents !== null} />
            <MenuMatrix metrics={metrics} error={metricsError} />
            <Panel title="Dönem Kesintileri">
              <dl className="divide-y divide-[var(--border)]">
                {([
                  ['Ödenecek KDV', data.current.vatCents],
                  ['İndirim', data.current.discountCents],
                  ['İptal', data.current.voidCents],
                  ['İade', data.current.refundCents],
                ] as const).map(([label, amount]) => (
                  <div key={label} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <dt className="text-[var(--text-secondary)]">{label}</dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(amount)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>
          <section aria-label="İşletme durumu" className="space-y-2">
            <h2 className="text-base font-semibold">İşletme Durumu</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <LivePanel live={data.live} />
              <AlertFeed alerts={data.alerts} />
              <MonthlyGoal />
            </div>
          </section>
        </>
      ) : (
        <>
          {!error ? <p className="text-sm text-[var(--text-secondary)]">Pano hazırlanıyor…</p> : null}
          {/* Hedef panodan bağımsız okunur; pano düşse de görünür kalır. */}
          <div className="max-w-md">
            <MonthlyGoal />
          </div>
        </>
      )}
    </div>
  );
};
