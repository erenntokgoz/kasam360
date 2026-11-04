import React, { useMemo, useState } from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaBucket } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

interface RevenueChartProps {
  kind: 'HOUR' | 'DAY';
  buckets: PanoramaBucket[];
}

const WORK_DAY_START = 8;

const dayLabel = (label: string) => label.split('-').reverse().slice(0, 2).join('.');

/** Gece boş saatler grafiği sıkıştırmasın: çalışma saatleri ve satış olan saatler kalır. */
function visibleBuckets(kind: RevenueChartProps['kind'], buckets: PanoramaBucket[]): PanoramaBucket[] {
  if (kind === 'DAY') return buckets;
  const used = buckets
    .map((item, index) => (item.currentCents + item.previousCents > 0 ? index : -1))
    .filter((index) => index >= 0);
  const first = Math.min(WORK_DAY_START, ...used);
  return buckets.slice(first);
}

export const RevenueChart: React.FC<RevenueChartProps> = ({ kind, buckets }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = useMemo(() => visibleBuckets(kind, buckets), [kind, buckets]);
  const peak = Math.max(1, ...shown.flatMap((item) => [item.currentCents, item.previousCents]));
  const hasSales = shown.some((item) => item.currentCents > 0);
  const every = shown.length > 16 ? Math.ceil(shown.length / 10) : 1;
  const active = hovered === null ? null : shown[hovered];
  const label = (item: PanoramaBucket) => (kind === 'HOUR' ? `${item.label}:00` : dayLabel(item.label));

  const title = kind === 'HOUR' ? 'Saatlere Göre Tahsilat' : 'Günlere Göre Tahsilat';
  if (!shown.some((item) => item.currentCents > 0 || item.previousCents > 0)) {
    return <Panel title={title}><p className="text-sm text-[var(--text-secondary)]">Bu dönemde tahsilat yok.</p></Panel>;
  }

  return (
    <Panel
      title={title}
      aside={
        <span className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[var(--accent-blue)]" aria-hidden />
            Bu dönem
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[var(--text-secondary)]" aria-hidden />
            Kıyas
          </span>
        </span>
      }
    >
      <div className="min-h-6 text-xs tabular-nums text-[var(--text-secondary)]">
        {active ? (
          <>
            <span className="font-bold text-[var(--text-primary)]">{label(active)}</span>
            {' · '}
            {formatMoney(active.currentCents)}
            {' · kıyas '}
            {formatMoney(active.previousCents)}
          </>
        ) : hasSales ? (
          `En yüksek ${formatMoney(peak)}`
        ) : (
          'Bu dönemde tahsilat yok.'
        )}
      </div>
      <div
        role="img"
        aria-label={shown.map((item) => `${label(item)}: ${formatMoney(item.currentCents)}`).join(', ')}
        className="flex-1 min-h-52 flex items-end gap-0.5 border-b border-[var(--border-strong)]"
        onPointerLeave={() => setHovered(null)}
      >
        {shown.map((item, index) => (
          <div
            key={item.label}
            className="relative flex-1 h-full flex items-end min-w-0 rounded-t hover:bg-[var(--bg-subtle)]"
            onPointerEnter={() => setHovered(index)}
          >
            {item.currentCents > 0 ? (
              <div
                className="w-full rounded-t bg-[var(--accent-blue)]"
                style={{ height: `${Math.max(2, (item.currentCents / peak) * 100)}%` }}
              />
            ) : null}
            {item.previousCents > 0 ? (
              <div
                className="absolute left-0 right-0 h-0.5 bg-[var(--text-secondary)] pointer-events-none"
                style={{ bottom: `${(item.previousCents / peak) * 100}%` }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-xs tabular-nums text-[var(--text-muted)]">
        {shown.map((item, index) => (
          <span key={item.label} className="flex-1 text-center min-w-0 overflow-visible whitespace-nowrap">
            {index % every === 0 ? (kind === 'HOUR' ? item.label : dayLabel(item.label)) : ''}
          </span>
        ))}
      </div>
    </Panel>
  );
};
