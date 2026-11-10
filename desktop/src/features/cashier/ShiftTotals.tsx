import React from 'react';
import { formatMoney } from '../../lib/formatMoney';
import type { ShiftSummary } from '../../types/shift';

/** Okunamayan tutar sıfır gösterilmez: kasa farkı sanılır. */
const money = (cents?: number | null) => (cents == null ? '—' : formatMoney(cents));

/**
 * Vardiya toplamları her zaman görünür: kasiyer çekmece sayımında bu şeride bakar.
 * Kör sayımda beklenen nakit ve onu türeten toplamlar hiç üretilmez; kasiyer farkı önceden kestiremesin.
 */
export const ShiftTotals: React.FC<{ summary: ShiftSummary; blind: boolean }> = ({ summary, blind }) => {
  const channels: Array<[string, number | null | undefined]> = [
    ...(blind ? [] : [
      ['Ciro', summary.totalSalesCents] as [string, number | null | undefined],
      ['Nakit satış', summary.totalCashSalesCents] as [string, number | null | undefined],
    ]),
    ['Kart', summary.totalCardSalesCents],
    ['Yemek kartı', summary.totalMealCardSalesCents],
    ['Veresiye', summary.totalVeresiyeCents],
  ];
  const expected = summary.expectedCashInDrawerCents;
  const negative = typeof expected === 'number' && expected < 0;

  return (
    <section aria-label="Vardiya toplamları" className="work-surface grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] md:grid-cols-[minmax(16rem,1.2fr)_minmax(0,3fr)]">
      {blind ? null : (
        <div className="bg-[var(--surface)] px-4 py-3">
          <div className="text-sm text-[var(--text-secondary)]">Beklenen kasa nakdi</div>
          <div
            data-testid="expected-cash"
            className={`text-[32px] leading-[38px] font-bold tabular-nums ${negative ? 'text-[var(--accent-red)]' : ''}`}
          >
            {money(expected)}
          </div>
          <div className="text-sm tabular-nums text-[var(--text-secondary)]">Açılış {money(summary.openingCashCents)}</div>
        </div>
      )}
      <dl className={`grid gap-px bg-[var(--border)] ${blind ? 'grid-cols-3 md:col-span-2' : 'grid-cols-2 sm:grid-cols-5'}`}>
        {channels.map(([label, value]) => (
          <div key={label} className="flex min-h-12 flex-col justify-center bg-[var(--surface)] px-4 py-3">
            <dt className="text-sm text-[var(--text-secondary)]">{label}</dt>
            <dd className="text-lg font-bold tabular-nums">{money(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
