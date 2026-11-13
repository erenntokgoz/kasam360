import React, { useMemo, useRef, useState } from 'react';
import { canAnimate, gsap, useGSAP, useRevealKey } from '../../../lib/dashMotion';
import { formatMoney } from '../../../lib/formatMoney';
import { hourLabel, hourlyWindow, peakHour, type HourSales } from '../../../lib/hourlyWindow';
import { Panel } from './Panel';

interface HourlyChartProps {
  hourly: HourSales[];
}

const PLOT_HEIGHT = 160;

/** Seçili dönemin günleri üst üste, yerel saate göre tahsilat. Çubuk yüksekliği tahsilatla orantılıdır. */
export const HourlyChart: React.FC<HourlyChartProps> = ({ hourly }) => {
  const plot = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = useMemo(() => hourlyWindow(hourly), [hourly]);
  const peak = useMemo(() => peakHour(hourly), [hourly]);
  const top = Math.max(1, ...shown.map((item) => item.collectedCents));
  const revealKey = useRevealKey(plot);

  // Çubuklar tabandan yükselir; yalnız transform oynar, veri aynı kaldıkça (30 sn yenileme) tekrar etmez.
  useGSAP(() => {
    if (!canAnimate() || shown.length === 0) return;
    gsap.from('.hour-bar', { scaleY: 0, transformOrigin: 'bottom', duration: 0.6, ease: 'power2.out', stagger: 0.025 });
  }, { scope: plot, dependencies: [shown.length, peak?.hour, revealKey], revertOnUpdate: true });

  if (shown.length === 0) return null;
  const active = hovered === null ? null : shown[hovered];

  return (
    <Panel title="Saatlere Göre Satış" subtitle={peak ? `En yoğun saat ${hourLabel(peak.hour)}, ${formatMoney(peak.collectedCents)}` : undefined}>
      <div className="chart-readout tabular-nums" aria-live="off">
        {active ? (
          <>
            <span className="font-bold text-[var(--text-primary)]">{hourLabel(active.hour)}</span>
            {` · ${formatMoney(active.collectedCents)} · ${active.orders} adisyon`}
          </>
        ) : null}
      </div>
      <div
        ref={plot}
        role="img"
        aria-label={shown.map((item) => `${hourLabel(item.hour)}: ${formatMoney(item.collectedCents)}`).join(', ')}
        className="hour-plot"
        style={{ height: PLOT_HEIGHT }}
        onPointerLeave={() => setHovered(null)}
      >
        {shown.map((item, index) => (
          <div key={item.hour} className="hour-col" data-active={hovered === index || undefined} onPointerEnter={() => setHovered(index)}>
            <span
              className="hour-bar"
              data-peak={peak?.hour === item.hour || undefined}
              style={{ height: `${Math.max(item.collectedCents > 0 ? 3 : 0, (item.collectedCents / top) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="hour-labels tabular-nums" aria-hidden>
        {shown.map((item) => <span key={item.hour} className="hour-label">{String(item.hour).padStart(2, '0')}</span>)}
      </div>
    </Panel>
  );
};
