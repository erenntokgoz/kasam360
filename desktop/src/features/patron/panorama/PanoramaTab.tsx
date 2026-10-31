import React, { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatTime } from '../../../lib/date';
import { RANGE_LABELS, reportPeriod, type RangeKey } from '../../../lib/dateRange';
import { buildInsights } from '../../../lib/panoramaInsights';
import { useAuthStore } from '../../../stores/authStore';
import { usePanoramaStore } from '../../../stores/panoramaStore';
import { useUIStore } from '../../../stores/uiStore';
import { Button } from '../../../ui/Button';
import { AlertFeed } from './AlertFeed';
import { KpiStrip } from './KpiStrip';
import { LivePanel } from './LivePanel';
import { MenuMatrix } from './MenuMatrix';
import { MonthlyGoal } from './MonthlyGoal';
import { PaymentMix } from './PaymentMix';
import { RevenueChart } from './RevenueChart';
import { TopProducts } from './TopProducts';

const REFRESH_MS = 30_000;
const RANGES: RangeKey[] = ['TODAY', 'YESTERDAY', 'WEEK', 'MONTH'];

/** Patronun tek bakışta gördüğü pano. Her rakam kayıtlı hareketten gelir. */
export const PanoramaTab: React.FC = () => {
  const { range, data, metrics, error, loadedAt, setRange, load } = usePanoramaStore();
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
    <div className="space-y-4 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Dönem">
          {RANGES.map((key) => (
            <Button
              key={key}
              variant={range === key ? 'primary' : 'secondary'}
              className="min-h-12 text-xs font-bold"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
            >
              {RANGE_LABELS[key]}
            </Button>
          ))}
        </div>
        <Button variant="secondary" className="min-h-12 text-xs" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4 mr-1.5" />
          <span className="tabular-nums">{loadedAt ? `Güncel: ${formatTime(loadedAt)}` : 'Yükleniyor'}</span>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Pano okunamadı: {error}
        </p>
      ) : null}

      {data ? (
        <>
          {insights.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{insights.join(' ')}</p>
          ) : null}
          <KpiStrip current={data.current} previous={data.previous} compareLabel={compareLabel} />
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
              <RevenueChart kind={data.bucketKind} buckets={data.buckets} />
            </div>
            <LivePanel live={data.live} current={data.current} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <AlertFeed alerts={data.alerts} />
            <PaymentMix channels={data.channels} />
            <MonthlyGoal target={metrics?.monthly_targets.find((item) => item.category === 'ALL') ?? null} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3">
              <TopProducts products={data.products} showProfit={data.current.grossProfitCents !== null} />
            </div>
            <div className="xl:col-span-2">
              <MenuMatrix metrics={metrics} />
            </div>
          </div>
        </>
      ) : !error ? (
        <p className="text-sm text-[var(--text-secondary)]">Pano hazırlanıyor…</p>
      ) : null}
    </div>
  );
};
