import React from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaData } from '../../../stores/panoramaStore';
import { useSyncStore, SYNC_STATE_LABEL } from '../../../stores/syncStore';
import { Panel } from './Panel';

const Row: React.FC<{ label: string; value: string; alarm?: boolean }> = ({ label, value, alarm }) => (
  <div className="flex items-center justify-between gap-3 min-h-9 border-b border-[var(--border)] last:border-b-0">
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

/** Seçilen dönemden bağımsız: patron şu anı görür. */
export const LivePanel: React.FC<{ live: PanoramaData['live'] }> = ({ live }) => {
  const syncState = useSyncStore((state) => state.status?.state);
  const fill = live.totalTables > 0 ? Math.round((live.openTables * 100) / live.totalTables) : 0;
  return (
    <Panel
      title="Şu An"
      aside={
        <span className={`text-xs font-bold ${live.shiftOpen ? 'text-[var(--accent-emerald)]' : 'text-[var(--text-muted)]'}`}>
          {live.shiftOpen ? 'Vardiya açık' : 'Vardiya kapalı'}
        </span>
      }
    >
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-[var(--text-secondary)]">Masa doluluğu</span>
          <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {live.openTables}
            <span className="text-sm text-[var(--text-muted)]"> / {live.totalTables}</span>
          </span>
        </div>
        <div className="h-2 mt-1.5 rounded bg-[var(--bg-subtle)] overflow-hidden" role="img" aria-label={`Doluluk yüzde ${fill}`}>
          <div className="h-full rounded bg-[var(--accent-blue)]" style={{ width: `${fill}%` }} />
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
