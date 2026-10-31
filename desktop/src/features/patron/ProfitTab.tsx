import React from 'react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { formatMoney } from '../../lib/formatMoney';

const Metric: React.FC<{ label: string; cents: number; tone?: string }> = ({
  label,
  cents,
  tone = 'text-[var(--text-primary)]',
}) => (
  <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
    <span className="text-xs text-[var(--text-secondary)] block">{label}</span>
    <span className={`text-2xl font-bold tabular-nums mt-1 block ${tone}`}>{formatMoney(cents)}</span>
  </div>
);

/** Tutarlar yalnız sunucu raporundan gelir; okunamayan rapor sıfır gösterilmez. */
export const ProfitTab: React.FC = () => {
  const { summary, ledgerError, isLoading } = useLedgerStore();

  if (!summary) {
    return (
      <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
        {isLoading ? 'Rapor yükleniyor…' : `Kâr raporu okunamadı${ledgerError ? `: ${ledgerError}` : '.'}`}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">Net Kâr Özeti</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          KDV hariçtir; satılan ürünlerin gerçek parti maliyeti düşülür.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Toplam Hasılat" cents={summary.totalRevenueCents} />
        <Metric label="Stok Maliyeti" cents={summary.totalCogsCents} tone="text-[var(--accent-red)]" />
        <Metric label="İşletme Giderleri" cents={summary.totalExpensesCents} />
        <Metric label="Net Kâr" cents={summary.netProfitCents} tone="text-[var(--accent-emerald)]" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Metric label="KDV" cents={summary.totalVatCents} />
        <Metric label="İadeler" cents={summary.totalRefundsCents} />
        <Metric label="Açık Alacak" cents={summary.receivablesCents} />
        <Metric label="Açık Borç" cents={summary.payablesCents} />
      </div>
    </div>
  );
};
