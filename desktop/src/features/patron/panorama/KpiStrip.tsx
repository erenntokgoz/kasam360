import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatMoney } from '../../../lib/formatMoney';
import { marginPercent, percentChange } from '../../../lib/panoramaInsights';
import type { Kpi } from '../../../stores/panoramaStore';

interface CellProps {
  label: string;
  value: string;
  note?: string;
  change: number | null;
  compareLabel: string;
}

/** Değişim rozeti: yön okla da verilir, renk tek başına anlam taşımaz. */
const Change: React.FC<{ change: number | null; compareLabel: string }> = ({ change, compareLabel }) => {
  if (change === null) {
    return <span className="kpi-compare">Kıyas verisi yok</span>;
  }
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const tone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return (
    <span className="kpi-change-row">
      <span className="kpi-chip" data-tone={tone}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        <span className="tabular-nums">%{Math.abs(change)}</span>
      </span>
      <span className="kpi-compare">{compareLabel}</span>
    </span>
  );
};

const Cell: React.FC<CellProps> = ({ label, value, note, change, compareLabel }) => (
  <div className="kpi-cell">
    <span className="kpi-label">{label}</span>
    <span className="kpi-value tabular-nums">{value}</span>
    <Change change={change} compareLabel={compareLabel} />
    {note ? <span className="kpi-note">{note}</span> : null}
  </div>
);

interface KpiStripProps {
  current: Kpi;
  previous: Kpi;
  compareLabel: string;
  /** Seçili dönemin adı: rakamlar bugünü değil seçili dönemi gösterir. */
  periodName: string;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ current, previous, compareLabel, periodName }) => {
  const profit = current.grossProfitCents;
  const margin = marginPercent(profit, current.collectedCents);
  const profitNote = current.costIncomplete
    ? `Maliyet eksik: ${current.costMissingSales} satışta parti yok, kâr yaklaşık`
    : margin !== null
      ? `Tahsilatın %${margin} kadarı, KDV ve maliyet düşülmüş`
      : 'KDV ve maliyet düşülmüş';
  return (
    <section aria-label="Dönem özeti" className="dash-card kpi-card">
      <Cell
        label={`${periodName} tahsilat`}
        value={formatMoney(current.collectedCents)}
        change={percentChange(current.collectedCents, previous.collectedCents)}
        compareLabel={compareLabel}
        note={current.discountCents > 0 ? `${formatMoney(current.discountCents)} indirim yapıldı` : undefined}
      />
      {profit !== null ? (
        <Cell
          label={current.costIncomplete ? 'Kâr (yaklaşık)' : 'Kâr'}
          value={current.costIncomplete ? `≈ ${formatMoney(profit)}` : formatMoney(profit)}
          change={percentChange(profit, previous.grossProfitCents ?? 0)}
          compareLabel={compareLabel}
          note={profitNote}
        />
      ) : null}
      <Cell
        label="Adisyon sayısı"
        value={String(current.orders)}
        change={percentChange(current.orders, previous.orders)}
        compareLabel={compareLabel}
      />
      <Cell
        label="Ortalama hesap"
        value={formatMoney(current.averageTicketCents)}
        change={percentChange(current.averageTicketCents, previous.averageTicketCents)}
        compareLabel={compareLabel}
      />
    </section>
  );
};
