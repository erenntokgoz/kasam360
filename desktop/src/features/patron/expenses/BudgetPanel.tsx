import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, useExpenseStore } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { CategorySelect } from './ExpensesTab';

export const BudgetPanel: React.FC = () => {
  const { budgets, setBudget } = useExpenseStore();
  const [category, setCategory] = useState('RENT');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(limit);

  const save = async (target: string, value: number) => {
    try {
      setError(null);
      await setBudget(target, value);
      setLimit('');
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Panel title="Aylık Bütçe">
      {budgets.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Henüz bütçe yok.</p> : null}
      <ul className="flex flex-col gap-3">
        {budgets.map((row) => (
          <li key={row.category}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-[var(--text-primary)]">{EXPENSE_CATEGORIES[row.category] ?? row.category}</span>
              <span className="tabular-nums text-[var(--text-secondary)]">
                {formatMoney(row.spentCents)} / {formatMoney(row.monthlyLimitCents)}
                <span className={row.isExceeded ? 'font-bold text-[var(--accent-red)]' : row.isNearLimit ? 'font-bold text-[var(--accent-amber)]' : ''}>
                  {row.isExceeded ? ' · Aşıldı' : row.isNearLimit ? ' · Sınıra yakın' : ''}
                </span>
              </span>
            </div>
            <div className="h-2 mt-1 rounded bg-[var(--bg-subtle)] overflow-hidden">
              <div
                className={`h-full rounded ${row.isExceeded ? 'bg-[var(--accent-red)]' : row.isNearLimit ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-blue)]'}`}
                style={{ width: `${Math.min(100, row.usedPercent)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 mt-auto">
        <CategorySelect value={category} onChange={setCategory} />
        <Input aria-label="Aylık sınır" inputMode="decimal" placeholder="Aylık sınır (₺)" className="min-h-12 tabular-nums !w-40" value={limit} onChange={(event) => setLimit(event.target.value)} />
        <Button variant="primary" className="min-h-12" disabled={cents === null || cents <= 0} onClick={() => cents !== null && void save(category, cents)}>
          Bütçe Koy
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
