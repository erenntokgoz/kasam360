import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, useExpenseStore } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { BudgetPanel } from './BudgetPanel';
import { RecurringPanel } from './RecurringPanel';

const METHODS = [
  { id: 'CASH', label: 'Nakit' },
  { id: 'CREDIT_CARD', label: 'Kart' },
  { id: 'BANK_TRANSFER', label: 'Havale' },
];

export const CategorySelect: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => (
  <select
    aria-label="Kategori"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className="min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]"
  >
    {Object.entries(EXPENSE_CATEGORIES).map(([id, label]) => (
      <option key={id} value={id}>{label}</option>
    ))}
  </select>
);

export const ExpensesTab: React.FC = () => {
  const { expenses, budgets, error, load, addExpense, voidExpense } = useExpenseStore();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const cents = parseCents(amount);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (cents === null || cents <= 0) return;
    try {
      setFormError(null);
      await addExpense(category, cents, method, note.trim());
      setAmount('');
      setNote('');
    } catch (caught) {
      setFormError(errorText(caught));
    }
  };

  const confirmVoid = async (id: string) => {
    try {
      setFormError(null);
      await voidExpense(id, voidReason.trim());
      setVoiding(null);
      setVoidReason('');
    } catch (caught) {
      setFormError(errorText(caught));
    }
  };

  const total = expenses?.reduce((sum, item) => sum + item.amountCents, 0) ?? 0;
  const limit = budgets.reduce((sum, item) => sum + item.monthlyLimitCents, 0);

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto">
      {error ? (
        <p role="alert" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Giderler okunamadı: {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Bu Ay Harcanan', value: expenses ? formatMoney(total) : 'Okunamadı' },
          { label: 'Toplam Bütçe', value: limit > 0 ? formatMoney(limit) : 'Tanımlı değil' },
          { label: 'Kalan', value: limit > 0 && expenses ? formatMoney(limit - budgets.reduce((sum, item) => sum + item.spentCents, 0)) : '-' },
        ].map((item) => (
          <div key={item.label} className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4">
            <span className="text-xs font-semibold text-[var(--text-secondary)] block">{item.label}</span>
            <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)] mt-1 block">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <BudgetPanel />
        <RecurringPanel />
      </div>

      <Panel title="Gider Ekle ve Bu Ayın Giderleri">
        <div className="flex flex-wrap gap-2">
          <CategorySelect value={category} onChange={setCategory} />
          <Input aria-label="Tutar" inputMode="decimal" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-36" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <Input aria-label="Açıklama" placeholder="Açıklama" className="min-h-12 !w-auto flex-1 min-w-48" value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="flex gap-1" role="group" aria-label="Ödeme şekli">
            {METHODS.map((item) => (
              <Button key={item.id} variant={method === item.id ? 'primary' : 'secondary'} className="min-h-12 text-xs" onClick={() => setMethod(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
          <Button variant="primary" className="min-h-12" disabled={cents === null || cents <= 0} onClick={() => void submit()}>
            Kaydet
          </Button>
        </div>
        {method === 'CASH' ? <p className="text-xs text-[var(--text-muted)]">Nakit gider açık vardiyanın kasasından düşer.</p> : null}
        {formError ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{formError}</p> : null}
        {expenses?.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Bu ay gider yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {expenses?.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="tabular-nums text-xs text-[var(--text-muted)] w-20">{item.expenseDate.slice(0, 10)}</span>
              <span className="font-semibold text-[var(--text-primary)] w-32 truncate">{EXPENSE_CATEGORIES[item.category] ?? item.category}</span>
              <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">{item.description || '-'}</span>
              <span className="tabular-nums font-bold text-[var(--text-primary)]">{formatMoney(item.amountCents)}</span>
              {voiding === item.id ? (
                <>
                  <Input aria-label="İptal nedeni" placeholder="İptal nedeni" className="min-h-12 !w-48" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
                  <Button variant="danger" className="min-h-12 text-xs" disabled={voidReason.trim() === ''} onClick={() => void confirmVoid(item.id)}>Onayla</Button>
                  <Button variant="ghost" className="min-h-12 text-xs" onClick={() => setVoiding(null)}>Vazgeç</Button>
                </>
              ) : (
                <Button variant="ghost" className="min-h-12 text-xs" onClick={() => { setVoiding(item.id); setVoidReason(''); }}>İptal</Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
};
