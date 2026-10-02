import React, { useMemo } from 'react';
import { Scale } from 'lucide-react';
import { formatCurrency } from '../helpers';
import { MutabakatBadge } from './MutabakatBadge';
import { ShiftRow } from '../types';

interface CashReconciliationProps {
  rows: ShiftRow[];
}

/**
 * Kasa mutabakat özeti (B5.5 - "dürüst" mutabakat).
 * Beklenen kasa ile fiili sayım farkı açıkça yazılır; fark yok sayılmaz.
 * Kapanmamış vardiyalar "Sayım Bekleniyor" olarak ayrı tutulur, toplama dahil edilmez.
 */
export const CashReconciliation: React.FC<CashReconciliationProps> = ({ rows }) => {
  const summary = useMemo(() => {
    let expectedTotal = 0;
    let countedTotal = 0;
    let countedCount = 0;
    let pendingCount = 0;

    rows.forEach((row) => {
      const expected =
        'expected_amount_cents' in row.shift && typeof row.shift.expected_amount_cents === 'number'
          ? row.shift.expected_amount_cents
          : 'openingBalance' in row.shift && typeof row.shift.openingBalance === 'number'
          ? row.shift.openingBalance
          : 0;

      expectedTotal += expected;

      if (row.isOpen) {
        pendingCount += 1;
        return;
      }

      const actual =
        'actual_amount_cents' in row.shift && typeof row.shift.actual_amount_cents === 'number'
          ? row.shift.actual_amount_cents
          : 'actualAmountCents' in row.shift && typeof row.shift.actualAmountCents === 'number'
          ? row.shift.actualAmountCents
          : null;

      if (actual !== null && typeof actual === 'number') {
        countedTotal += actual;
        countedCount += 1;
      }
    });

    const diff = countedCount > 0 ? countedTotal - expectedTotal : null;

    return { expectedTotal, countedTotal, countedCount, pendingCount, diff };
  }, [rows]);

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-amber-600 dark:text-amber-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
          <Scale size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">Kasa Mutabakati</h2>
          <p className="text-xs dark:text-zinc-400 text-zinc-500">
            Beklenen kasa ile fiili sayim karsilastirilmasi; acik fark gizlenmez
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Beklenen Kasa</p>
          <p data-testid="recon-expected" className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900">
            {formatCurrency(summary.expectedTotal)}
          </p>
        </div>

        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Fiili Sayim</p>
          <p data-testid="recon-counted" className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900">
            {summary.countedCount > 0 ? formatCurrency(summary.countedTotal) : 'Sayim Bekleniyor'}
          </p>
        </div>

        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Fark</p>
          <div className="mt-0.5">
            <MutabakatBadge
              status={summary.countedCount > 0 ? 'CLOSED' : 'OPEN'}
              diff={summary.diff}
            />
          </div>
        </div>
      </div>

      {summary.pendingCount > 0 && (
        <p className="text-[11px] dark:text-zinc-400 text-zinc-500 mt-3">
          {summary.pendingCount} acik vardiya sayim bekliyor; bu vardiyalar mutabakat toplamina dahil edilmedi.
        </p>
      )}
    </div>
  );
};

export default CashReconciliation;