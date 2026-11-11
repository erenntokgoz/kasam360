import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { areaPath, axisLabel, niceAxisMaxLira, smoothPath, type ChartPoint } from '../../../lib/chartPath';
import { canAnimate, gsap, useGSAP } from '../../../lib/dashMotion';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaBucket } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

interface RevenueChartProps {
  kind: 'HOUR' | 'DAY';
  buckets: PanoramaBucket[];
  /** Dönem seçimi grafiğin başlığında durur; veri yokken de erişilebilir kalır. */
  toolbar: React.ReactNode;
}

const WORK_DAY_START = 8;
const PLOT_HEIGHT = 240;
const FALLBACK_WIDTH = 640;
const TOP_PAD = 12;
const GRID_LINES = 4;

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

export const RevenueChart: React.FC<RevenueChartProps> = ({ kind, buckets, toolbar }) => {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = useMemo(() => visibleBuckets(kind, buckets), [kind, buckets]);
  const hasAny = shown.some((item) => item.currentCents > 0 || item.previousCents > 0);
  const peak = Math.max(1, ...shown.flatMap((item) => [item.currentCents, item.previousCents]));
  const axisMaxCents = niceAxisMaxLira(peak) * 100;
  const hasSales = shown.some((item) => item.currentCents > 0);
  const every = shown.length > 12 ? Math.ceil(shown.length / 8) : 1;
  const label = (item: PanoramaBucket) => (kind === 'HOUR' ? `${item.label}:00` : dayLabel(item.label));
  const baseY = PLOT_HEIGHT;

  useLayoutEffect(() => {
    const node = plot.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.max(240, Math.round(node.clientWidth)) || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasAny]);

  const geometry = useMemo(() => {
    const xAt = (index: number) => (shown.length <= 1 ? width / 2 : (index / (shown.length - 1)) * width);
    const yAt = (cents: number) => TOP_PAD + (1 - cents / axisMaxCents) * (PLOT_HEIGHT - TOP_PAD);
    const current: ChartPoint[] = shown.map((item, index) => ({ x: xAt(index), y: yAt(item.currentCents) }));
    const previous: ChartPoint[] = shown.map((item, index) => ({ x: xAt(index), y: yAt(item.previousCents) }));
    const line = smoothPath(current);
    return { current, line, area: areaPath(line, current, baseY), previousLine: smoothPath(previous), yAt };
  }, [shown, width, axisMaxCents, baseY]);

  // Çizgi soldan sağa çizilir, alan ve kıyas çizgisi arkasından belirir. Yalnız
  // stroke-dashoffset ve opacity oynar; veri aynı kaldıkça (30 sn yenileme) yeniden oynamaz.
  const lineRef = useRef<SVGPathElement>(null);
  useGSAP(() => {
    if (!canAnimate() || !lineRef.current || !geometry.line) return;
    const length = lineRef.current.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return;
    gsap.fromTo(
      lineRef.current,
      { strokeDasharray: length, strokeDashoffset: length },
      { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' },
    );
    gsap.from('.chart-area, .chart-previous', { opacity: 0, duration: 0.7, delay: 0.5, ease: 'power1.out' });
  }, { scope: plot, dependencies: [geometry.line], revertOnUpdate: true });

  const title = kind === 'HOUR' ? 'Saatlere Göre Tahsilat' : 'Günlere Göre Tahsilat';
  const active = hovered === null ? null : shown[hovered];

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (shown.length === 0 || box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHovered(Math.round(fraction * (shown.length - 1)));
  };

  const legend = (
    <span className="chart-legend">
      <span className="chart-legend-item"><span className="chart-swatch" aria-hidden />Bu dönem</span>
      <span className="chart-legend-item"><span className="chart-swatch chart-swatch-dash" aria-hidden />Kıyas</span>
    </span>
  );

  return (
    <Panel title={title} subtitle={hasSales ? `En yüksek ${formatMoney(peak)}` : undefined} aside={hasAny ? legend : null}>
      {toolbar}
      {!hasAny ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu dönemde tahsilat yok.</p>
      ) : (
        <>
          <div className="chart-readout tabular-nums" aria-live="off">
            {active ? (
              <>
                <span className="font-bold text-[var(--text-primary)]">{label(active)}</span>
                {' · '}
                {formatMoney(active.currentCents)}
                {' · kıyas '}
                {formatMoney(active.previousCents)}
              </>
            ) : null}
          </div>
          <div
            ref={plot}
            role="img"
            aria-label={shown.map((item) => `${label(item)}: ${formatMoney(item.currentCents)}`).join(', ')}
            className="chart-plot"
            style={{ height: PLOT_HEIGHT }}
            onPointerMove={onMove}
            onPointerLeave={() => setHovered(null)}
          >
            <svg width={width} height={PLOT_HEIGHT} viewBox={`0 0 ${width} ${PLOT_HEIGHT}`} aria-hidden>
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--action)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--action)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
                const y = geometry.yAt((axisMaxCents * index) / GRID_LINES);
                return <line key={index} className="chart-grid" x1={0} x2={width} y1={y} y2={y} />;
              })}
              <path className="chart-area" d={geometry.area} fill="url(#chart-fill)" />
              <path className="chart-previous" d={geometry.previousLine} />
              <path ref={lineRef} className="chart-line" d={geometry.line} />
            </svg>
            {Array.from({ length: GRID_LINES }, (_, index) => {
              const lira = (niceAxisMaxLira(peak) * (index + 1)) / GRID_LINES;
              return (
                <span key={index} className="chart-ylabel tabular-nums" style={{ top: geometry.yAt((axisMaxCents * (index + 1)) / GRID_LINES) - 18 }}>
                  {axisLabel(lira)}
                </span>
              );
            })}
            {hovered !== null ? (
              <>
                <span className="chart-cursor" style={{ left: geometry.current[hovered].x }} />
                <span className="chart-dot" style={{ left: geometry.current[hovered].x, top: geometry.current[hovered].y }} />
              </>
            ) : null}
          </div>
          <div className="chart-xlabels tabular-nums" aria-hidden>
            {shown.map((item, index) => (index % every === 0 ? (
              <span
                key={item.label}
                className="chart-xlabel"
                data-edge={index === 0 ? 'start' : index === shown.length - 1 ? 'end' : undefined}
                style={{ left: `${shown.length <= 1 ? 50 : (index / (shown.length - 1)) * 100}%` }}
              >
                {kind === 'HOUR' ? item.label : dayLabel(item.label)}
              </span>
            ) : null))}
          </div>
        </>
      )}
    </Panel>
  );
};
