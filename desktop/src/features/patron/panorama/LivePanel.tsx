import React, { useRef } from 'react';
import { canAnimate, gsap, useGSAP } from '../../../lib/dashMotion';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaData } from '../../../stores/panoramaStore';
import { useSyncStore, SYNC_STATE_LABEL } from '../../../stores/syncStore';
import { Panel } from './Panel';

const Row: React.FC<{ label: string; value: string; alarm?: boolean }> = ({ label, value, alarm }) => (
  <div className="live-row">
    <span className="text-xs text-[var(--text-secondary)]">{label}</span>
    <span className={`text-sm font-bold tabular-nums ${alarm ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'}`}>
      {value}
    </span>
  </div>
);

const duration = (minutes: number) => {
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
};

const MAX_BARS = 36;

/** Her çubuk bir masadır: dolu masa uzun, boş masa kısa durur. Çok masada sayı orantılı küçülür. */
export function tableBars(openTables: number, totalTables: number): boolean[] {
  if (totalTables <= 0) return [];
  const bars = Math.min(totalTables, MAX_BARS);
  const filled = Math.min(bars, Math.round((openTables * bars) / totalTables));
  return Array.from({ length: bars }, (_, index) => index < filled);
}

/** Seçilen dönemden bağımsız: patron şu anı görür. */
export const LivePanel: React.FC<{ live: PanoramaData['live'] }> = ({ live }) => {
  const root = useRef<HTMLDivElement>(null);
  const syncState = useSyncStore((state) => state.status?.state);
  const bars = tableBars(live.openTables, live.totalTables);
  const fill = live.totalTables > 0 ? Math.round((live.openTables * 100) / live.totalTables) : 0;

  // Çubuklar tabandan yükselir; yalnız transform oynar.
  useGSAP(() => {
    if (!canAnimate()) return;
    gsap.from('.live-bar', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.5, ease: 'power2.out', stagger: 0.012 });
  }, { scope: root, dependencies: [bars.length], revertOnUpdate: true });

  return (
    <Panel
      title="Şu An"
      aside={
        <span className="live-state" data-on={live.shiftOpen}>
          <span className="live-dot" aria-hidden />
          {live.shiftOpen ? 'Vardiya açık' : 'Vardiya kapalı'}
        </span>
      }
    >
      <div ref={root}>
        <div className="live-figure">
          <span className="live-number tabular-nums">{live.openTables}</span>
          <span className="live-of tabular-nums">/ {live.totalTables} masa dolu</span>
        </div>
        <div className="live-bars" role="img" aria-label={`Masa doluluğu yüzde ${fill}`}>
          {bars.map((isFilled, index) => (
            <span key={index} className="live-bar" data-filled={isFilled} />
          ))}
        </div>
      </div>
      <div>
        <Row label="Açık hesap" value={`${live.openOrders} · ${formatMoney(live.openOrderCents)}`} />
        <Row label="Mutfakta bekleyen" value={`${live.kitchenWaiting} kalem`} />
        <Row label="En uzun açık hesap" value={live.openOrders > 0 ? duration(live.longestOpenMinutes) : '-'} alarm={live.longestOpenMinutes > 180} />
        {syncState ? <Row label="Cihaz eşitleme" value={SYNC_STATE_LABEL[syncState]} alarm={syncState !== 'READY'} /> : null}
      </div>
    </Panel>
  );
};
