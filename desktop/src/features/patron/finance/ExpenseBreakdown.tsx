import React from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import { EXPENSE_LABELS } from '../../../stores/expenseStore';
import type { ExpenseCategorySummary, MonthlyFinancialTrend } from '../../../types/ledger';
import { Panel } from '../panorama/Panel';

/** Dönem giderinin kategori payı. Pay yüzdesi toplamdan tamsayı bölmeyle çıkar, kuruş float olmaz. */
export const ExpenseBreakdown: React.FC<{ rows: ExpenseCategorySummary[]; totalCents: number }> = ({ rows, totalCents }) => (
  <Panel title="Gider Kırılımı" aside={<span className="text-xs tabular-nums text-[var(--text-secondary)]">{formatMoney(totalCents)}</span>}>
    {rows.length === 0 ? (
      <p className="text-sm text-[var(--text-secondary)]">Bu ayda gider kaydı yok.</p>
    ) : (
      <ul className="space-y-2.5">
        {rows.map((row) => {
          const share = totalCents > 0 ? Math.round((row.totalCents * 100) / totalCents) : 0;
          return (
            <li key={row.category} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{EXPENSE_LABELS[row.category] ?? row.category}
                  <span className="ml-2 text-xs font-normal tabular-nums text-[var(--text-muted)]">{row.count} kayıt</span>
                </span>
                <span className="tabular-nums">{formatMoney(row.totalCents)} <span className="text-xs text-[var(--text-secondary)]">%{share}</span></span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-[var(--bg-subtle)]">
                <div className="h-full rounded bg-[var(--accent-blue)]" style={{ width: `${Math.min(100, share)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </Panel>
);

const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });

/** Son aylar: gelir ile gider farkı. COGS ve KDV düşülmediği için buradaki fark Kâr Hesabı'ndaki net kâr değildir. */
export const MonthlyTrend: React.FC<{ rows: MonthlyFinancialTrend[] }> = ({ rows }) => (
  <Panel title="Aylık Seyir" aside={<span className="text-xs text-[var(--text-muted)]">Gelir − gider, COGS ve KDV hariç</span>}>
    {rows.length === 0 ? (
      <p className="text-sm text-[var(--text-secondary)]">Henüz kapanan satış yok.</p>
    ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--text-muted)]">
            <th className="py-1.5 font-medium">Ay</th>
            <th className="py-1.5 text-right font-medium">Gelir</th>
            <th className="py-1.5 text-right font-medium">Gider</th>
            <th className="py-1.5 text-right font-medium">Fark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="border-t border-[var(--border)]">
              <td className="py-2">{monthName.format(new Date(`${row.month}-01T00:00:00`))}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(row.revenueCents)}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(row.expenseCents)}</td>
              <td className={`py-2 text-right font-semibold tabular-nums ${row.profitCents < 0 ? 'text-[var(--accent-red)]' : ''}`}>{formatMoney(row.profitCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Panel>
);
