import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatMoney } from '../../../lib/formatMoney';
import { marginPercent, percentChange } from '../../../lib/panoramaInsights';
import type { Kpi } from '../../../stores/panoramaStore';

interface TileProps {
  label: string;
  value: string;
  note?: string;
  change: number | null;
  compareLabel: string;
}

const Change: React.FC<{ change: number | null; compareLabel: string }> = ({ change, compareLabel }) => {
  if (change === null) {
    return <span className="text-xs text-[var(--text-muted)]">Kıyas verisi yok</span>;
  }
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const tone = change > 0 ? 'text-[var(--accent-emerald)]' : change < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]';
  return (
    <span className="flex items-center gap-1 text-xs min-w-0">
      <Icon className={`w-4 h-4 shrink-0 ${tone}`} aria-hidden />
      <span className={`font-bold tabular-nums ${tone}`}>%{Math.abs(change)}</span>
      <span className="text-[var(--text-muted)] truncate">{compareLabel}</span>
    </span>
  );
};

const Tile: React.FC<TileProps> = ({ label, value, note, change, compareLabel }) => (
  <div className="paper border border-[var(--border)] rounded-xl p-4 flex flex-col gap-1.5 min-w-0">
    <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
    <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)] truncate">{value}</span>
    <Change change={change} compareLabel={compareLabel} />
    {note ? <span className="text-xs text-[var(--text-muted)]">{note}</span> : null}
  </div>
);

interface KpiStripProps {
  current: Kpi;
  previous: Kpi;
  compareLabel: string;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ current, previous, compareLabel }) => {
  const profit = current.grossProfitCents;
  const margin = marginPercent(profit, current.collectedCents);
  const profitNote = current.costIncomplete
    ? `Maliyet eksik: ${current.costMissingSales} satışta parti yok, kâr yaklaşık`
    : margin !== null
      ? `Tahsilatın %${margin} kadarı, KDV ve maliyet düşülmüş`
      : 'KDV ve maliyet düşülmüş';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Tile
        label="Tahsil Edilen"
        value={formatMoney(current.collectedCents)}
        change={percentChange(current.collectedCents, previous.collectedCents)}
        compareLabel={compareLabel}
        note={current.discountCents > 0 ? `${formatMoney(current.discountCents)} indirim yapıldı` : undefined}
      />
      {profit !== null ? (
        <Tile
          label={current.costIncomplete ? 'Kâr (yaklaşık)' : 'Kâr'}
          value={current.costIncomplete ? `≈ ${formatMoney(profit)}` : formatMoney(profit)}
          change={percentChange(profit, previous.grossProfitCents ?? 0)}
          compareLabel={compareLabel}
          note={profitNote}
        />
      ) : null}
      <Tile
        label="Kapanan Adisyon"
        value={String(current.orders)}
        change={percentChange(current.orders, previous.orders)}
        compareLabel={compareLabel}
      />
      <Tile
        label="Ortalama Hesap"
        value={formatMoney(current.averageTicketCents)}
        change={percentChange(current.averageTicketCents, previous.averageTicketCents)}
        compareLabel={compareLabel}
      />
    </div>
  );
};
