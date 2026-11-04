import React from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import type { FinancialProfitSummary } from '../../../types/ledger';
import { Panel } from '../panorama/Panel';

const Row: React.FC<{ label: string; cents: number; minus?: boolean; total?: boolean; approximate?: boolean }> = ({
  label,
  cents,
  minus,
  total,
  approximate,
}) => (
  <div className={`flex justify-between gap-4 py-2 ${total ? 'border-t border-[var(--border)] font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
    <dt>{minus ? `− ${label}` : approximate ? `${label} (yaklaşık)` : label}</dt>
    <dd className="tabular-nums">{approximate ? `≈ ${formatMoney(cents)}` : formatMoney(cents)}</dd>
  </div>
);

/**
 * Kâr bir rakam değil hesaptır: her kalem gösterilir, toplamlar buradan okunur.
 * Partisiz satılan kalemin maliyeti sıfır sayılmıştır; o durumda kâr kesin rakam gibi sunulmaz.
 */
export const ProfitStatement: React.FC<{ report: FinancialProfitSummary }> = ({ report }) => {
  const approximate = report.costMissingLines > 0;
  return (
    <Panel title="Kâr Hesabı">
      {approximate ? (
        <p role="status" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Maliyet eksik: <span className="tabular-nums">{report.costMissingLines}</span> kalem partisi olmadan satıldı. Kâr gerçeğinden yüksek olabilir.
        </p>
      ) : null}
      <dl className="text-sm">
        <Row label="Satış Hasılatı" cents={report.totalRevenueCents} />
        <Row label="İadeler" cents={report.totalRefundsCents} minus />
        <Row label="KDV" cents={report.totalVatCents} minus />
        <Row label="Satılan Malın Maliyeti" cents={report.totalCogsCents} minus />
        <Row label="Brüt Kâr" cents={report.grossProfitCents} total approximate={approximate} />
        <Row label="İşletme Giderleri" cents={report.totalExpensesCents} minus />
        <Row label="Net Kâr" cents={report.netProfitCents} total approximate={approximate} />
      </dl>
      <p className="text-xs text-[var(--text-muted)]">
        Bugünkü cari durum: açık alacak {formatMoney(report.receivablesCents)}, açık borç {formatMoney(report.payablesCents)}.
      </p>
    </Panel>
  );
};
