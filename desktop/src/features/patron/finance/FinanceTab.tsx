import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, useExpenseStore, type Expense } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { Modal } from '../../../ui/Modal';
import { formatDay } from '../../../lib/date';

const monthOf = (offset: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

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

/** Gider, sabit gider, bütçe ve kâr aynı ayı gösterir; dönem tek yerden seçilir. */
export const FinanceTab: React.FC = () => {
  const { period, setPeriod, expenses, error, load, addExpense, voidExpense, editExpense } = useExpenseStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const cents = parseCents(amount);

  useEffect(() => {
    void load();
  }, [load]);

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setAmount('');
    setNote('');
  };

  const submit = async () => {
    if (cents === null || cents <= 0) return;
    try {
      setFormError(null);
      if (editing) await editExpense(editing, category, cents, method, note.trim());
      else await addExpense(category, cents, method, note.trim());
      closeForm();
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
  const totalOf = (method: string) => formatMoney(expenses?.filter((item) => item.paymentMethod === method).reduce((sum, item) => sum + item.amountCents, 0) ?? 0);

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Giderler okunamadı: {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          Dönem
          <Input aria-label="Finans dönemi" type="month" className="min-h-12 !w-44 tabular-nums" value={period} onChange={(event) => setPeriod(event.target.value)} />
        </label>
        {[
          ['Bu Ay', monthOf(0)],
          ['Geçen Ay', monthOf(-1)],
          ['2 Ay Önce', monthOf(-2)],
        ].map(([label, value]) => (
          <Button key={label} variant={period === value ? 'selected' : 'secondary'} className="min-h-12" onClick={() => setPeriod(value)}>
            {label}
          </Button>
        ))}
        <Button variant="primary" className="min-h-12 ml-auto" onClick={() => setIsFormOpen(true)}>Gider Ekle</Button>
      </div>

      <div className="paper border border-[var(--border)] rounded-xl p-4 flex flex-wrap gap-x-10 gap-y-3">
        {[
          ['Dönem Gideri', expenses ? formatMoney(total) : 'Okunamadı'],
          ['Nakit', totalOf('CASH')],
          ['Kart', totalOf('CREDIT_CARD')],
          ['Havale', totalOf('BANK_TRANSFER')],
        ].map(([label, value]) => (
          <span key={label}>
            <span className="block text-xs text-[var(--text-secondary)]">{label}</span>
            <span className="block text-lg font-bold tabular-nums">{value}</span>
          </span>
        ))}
      </div>

      {isFormOpen ? (
      <Modal isOpen onClose={closeForm} title={editing ? 'Gideri Düzenle' : 'Gider Ekle'} maxWidth="md">
        <div className="flex flex-wrap gap-2">
          <CategorySelect value={category} onChange={setCategory} />
          <NumberInput aria-label="Tutar" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-36" value={amount} onValueChange={setAmount} />
          <Input aria-label="Açıklama" placeholder="Açıklama" className="min-h-12 !w-auto flex-1 min-w-48" value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="flex gap-1" role="group" aria-label="Ödeme şekli">
            {METHODS.map((item) => (
              <Button key={item.id} variant={method === item.id ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setMethod(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
          <Button variant="primary" className="min-h-12" disabled={cents === null || cents <= 0} onClick={() => void submit()}>
            {editing ? 'Değişikliği Kaydet' : 'Kaydet'}
          </Button>
        </div>
        {formError ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{formError}</p> : null}
      </Modal>
      ) : null}

      <Panel title="Dönem Giderleri">
        {expenses?.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Bu dönemde gider yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {expenses?.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="tabular-nums text-xs text-[var(--text-muted)] w-20">{formatDay(item.expenseDate)}</span>
              <span className="font-semibold text-[var(--text-primary)] w-32 truncate">{EXPENSE_CATEGORIES[item.category] ?? item.category}</span>
              <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">{item.description || '-'}</span>
              <span className="tabular-nums font-bold text-[var(--text-primary)]">{formatMoney(item.amountCents)}</span>
              {voiding === item.id ? (
                <>
                  <Input aria-label="İptal nedeni" placeholder="İptal nedeni" className="min-h-12 !w-48" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
                  <Button variant="danger" className="min-h-12 text-sm" disabled={voidReason.trim() === ''} onClick={() => void confirmVoid(item.id)}>Onayla</Button>
                  <Button variant="ghost" className="min-h-12 text-sm" onClick={() => setVoiding(null)}>Vazgeç</Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="min-h-12 text-sm"
                    onClick={() => {
                      setEditing(item);
                      setIsFormOpen(true);
                      setCategory(item.category);
                      setAmount(centsToText(item.amountCents));
                      setMethod(item.paymentMethod);
                      setNote(item.description ?? '');
                    }}
                  >
                    Düzenle
                  </Button>
                  <Button variant="ghost" className="min-h-12 text-sm" onClick={() => { setVoiding(item.id); setVoidReason(''); }}>İptal</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
};
