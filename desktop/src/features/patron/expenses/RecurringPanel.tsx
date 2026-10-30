import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { useExpenseStore, type RecurringRow } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { CategorySelect } from './ExpensesTab';

/** Ödeme aynı başlıkla gider yazar; bu ay ödenip ödenmediği oradan anlaşılır. */
export const RecurringPanel: React.FC = () => {
  const { recurring, expenses, addRecurring, removeRecurring, addExpense } = useExpenseStore();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('RENT');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);
  const dueDay = Number(day);
  const ready = title.trim().length > 0 && cents !== null && cents > 0 && dueDay >= 1 && dueDay <= 31;

  const run = async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const isPaid = (row: RecurringRow) => expenses?.some((item) => item.description === row.title) ?? false;

  return (
    <Panel title="Sabit Giderler">
      {recurring.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Kira, fatura gibi sabit gider yok.</p> : null}
      <ul className="flex flex-col gap-1">
        {recurring.map((row) => {
          const paid = isPaid(row);
          return (
            <li key={row.id} className="flex items-center gap-2 min-h-12">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{row.title}</span>
                <span className={`block text-xs ${!paid && row.isOverdue ? 'font-bold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {paid ? 'Bu ay ödendi' : row.isOverdue ? `Ayın ${row.dueDay}. günü geçti` : `Ayın ${row.dueDay}. günü`}
                </span>
              </span>
              <span className="tabular-nums text-sm font-bold text-[var(--text-primary)]">{formatMoney(row.amountCents)}</span>
              <Button
                variant="secondary"
                className="min-h-12 text-xs"
                disabled={paid}
                onClick={() => void run(() => addExpense(row.category, row.amountCents, 'BANK_TRANSFER', row.title))}
              >
                Öde
              </Button>
              <Button variant="ghost" className="min-h-12 text-xs" onClick={() => void run(() => removeRecurring(row.id))}>
                Kaldır
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2 mt-auto">
        <Input aria-label="Başlık" placeholder="Başlık (Kira)" className="min-h-12 !w-auto flex-1 min-w-32" value={title} onChange={(event) => setTitle(event.target.value)} />
        <CategorySelect value={category} onChange={setCategory} />
        <Input aria-label="Tutar" inputMode="decimal" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-28" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Input aria-label="Ayın günü" inputMode="numeric" placeholder="Gün" className="min-h-12 tabular-nums !w-20" value={day} onChange={(event) => setDay(event.target.value)} />
        <Button
          variant="primary"
          className="min-h-12"
          disabled={!ready}
          onClick={() => void run(async () => {
            await addRecurring(title.trim(), category, cents ?? 0, dueDay);
            setTitle('');
            setAmount('');
          })}
        >
          Ekle
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
