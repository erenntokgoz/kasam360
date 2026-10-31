import React from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import type { FinancialProfitSummary } from '../../../types/ledger';
import { Panel } from '../panorama/Panel';

const Row: React.FC<{ label: string; cents: number; minus?: boolean; total?: boolean }> = ({ label, cents, minus, total }) => (
  <div className={`flex justify-between gap-4 py-2 ${total ? 'border-t border-[var(--border)] font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
    <dt>{minus ? `− ${label}` : label}</dt>
    <dd className="tabular-nums">{formatMoney(cents)}</dd>
  </div>
);

/** Kâr bir rakam değil hesaptır: her kalem gösterilir, toplamlar buradan okunur. */
export const ProfitStatement: React.FC<{ report: FinancialProfitSummary }> = ({ report }) => (
  <Panel title="Kâr Hesabı">
    <dl className="text-sm">
      <Row label="Satış Hasılatı" cents={report.totalRevenueCents} />
      <Row label="İadeler" cents={report.totalRefundsCents} minus />
      <Row label="KDV" cents={report.totalVatCents} minus />
      <Row label="Satılan Malın Maliyeti" cents={report.totalCogsCents} minus />
      <Row label="Brüt Kâr" cents={report.grossProfitCents} total />
      <Row label="İşletme Giderleri" cents={report.totalExpensesCents} minus />
      <Row label="Net Kâr" cents={report.netProfitCents} total />
    </dl>
    <p className="text-xs text-[var(--text-muted)]">
      Bugünkü cari durum: açık alacak {formatMoney(report.receivablesCents)}, açık borç {formatMoney(report.payablesCents)}.
    </p>
  </Panel>
);
