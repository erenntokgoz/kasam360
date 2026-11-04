import React from 'react';
import { carriedOpenDebts, matchingPeriod, PERIOD_LABELS, statementPeriod, type PeriodKey } from '../../lib/cariLedger';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { BalanceCell, CarriedDebtRow, COLUMN_COUNT, StatementRow, type DebtActions } from './CariStatementRow';
import type { DirectoryStatement, LedgerDebt } from '../../types/ledger';

const PERIODS: PeriodKey[] = ['THIS_MONTH', 'LAST_MONTH', 'ALL'];

interface CariStatementProps {
  statement: DirectoryStatement | null;
  debts: LedgerDebt[];
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  actions: DebtActions;
}

export const CariStatement: React.FC<CariStatementProps> = ({ statement, debts, from, to, onRangeChange, actions }) => {
  const active = matchingPeriod(from, to);
  const openById = new Map(debts.filter((debt) => debt.status !== 'PAID').map((debt) => [debt.id, debt]));
  const carried = statement ? carriedOpenDebts(debts, statement.lines) : [];

  return (
    <section className="paper border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-[var(--text-primary)]">Ekstre</h4>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((key) => (
            <Button
              key={key}
              variant={active === key ? 'selected' : 'secondary'}
              aria-pressed={active === key}
              onClick={() => {
                const period = statementPeriod(key);
                onRangeChange(period.from, period.to);
              }}
              className="min-h-12"
            >
              {PERIOD_LABELS[key]}
            </Button>
          ))}
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(event) => event.target.value && onRangeChange(event.target.value, to)}
            aria-label="Başlangıç"
            className="w-40 min-h-12 tabular-nums"
          />
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(event) => event.target.value && onRangeChange(from, event.target.value)}
            aria-label="Bitiş"
            className="w-40 min-h-12 tabular-nums"
          />
        </div>
      </div>
      {statement ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)] text-left">
              <tr className="border-b border-[var(--border)]">
                <th className="px-3 py-2 font-semibold">Tarih</th>
                <th className="px-3 py-2 font-semibold">İşlem</th>
                <th className="px-3 py-2 font-semibold">Bağlantı</th>
                <th className="px-3 py-2 font-semibold text-right">Borç</th>
                <th className="px-3 py-2 font-semibold text-right">Alacak</th>
                <th className="px-3 py-2 font-semibold text-right">Bakiye</th>
                <th className="px-3 py-2" aria-label="İşlemler" />
              </tr>
            </thead>
            <tbody className="tabular-nums text-[var(--text-primary)]">
              <tr className="border-b border-[var(--border)]">
                <td colSpan={5} className="px-3 py-2 font-semibold text-[var(--text-secondary)]">Açılış</td>
                <td className="px-3 py-2 text-right"><BalanceCell cents={statement.openingBalanceCents} /></td>
                <td />
              </tr>
              {carried.map((debt) => (
                <CarriedDebtRow key={debt.id} debt={debt} actions={actions} />
              ))}
              {statement.lines.length === 0 ? (
                <tr className="border-b border-[var(--border)]">
                  <td colSpan={COLUMN_COUNT} className="px-3 py-4 text-center text-[var(--text-muted)]">Bu dönemde hareket yok.</td>
                </tr>
              ) : null}
              {statement.lines.map((line) => (
                <StatementRow
                  key={line.id}
                  line={line}
                  openDebt={line.kind === 'BORC_ACILDI' ? openById.get(line.debtId) ?? null : null}
                  actions={actions}
                />
              ))}
              <tr className="border-b border-[var(--border)] font-semibold">
                <td colSpan={3} className="px-3 py-2">Dönem toplamı</td>
                <td className="px-3 py-2 text-right">{formatMoney(statement.totalDebitCents)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(statement.totalCreditCents)}</td>
                <td colSpan={2} />
              </tr>
              <tr className="font-bold">
                <td colSpan={5} className="px-3 py-2">Kapanış</td>
                <td className="px-3 py-2 text-right"><BalanceCell cents={statement.closingBalanceCents} /></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
};
