import React, { useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, needsDescription, useExpenseStore, type RecurringRow } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { Panel } from '../panorama/Panel';
import { CategorySelect, Field } from './FinanceTab';

interface Draft {
  id: string | null;
  category: string;
  description: string;
  amount: string;
  day: string;
}

const EMPTY: Draft = { id: null, category: 'RENT', description: '', amount: '', day: '1' };

/** Ödeme aynı başlıkla gider yazar; bu ay ödenip ödenmediği oradan anlaşılır. */
export const RecurringPanel: React.FC = () => {
  const { recurring, expenses, addRecurring, removeRecurring, updateRecurring, addExpense } = useExpenseStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const isPaid = (row: RecurringRow) => expenses?.some((item) => item.recurringId === row.id || (item.recurringId === null && item.description === row.title)) ?? false;

  const cents = draft ? parseCents(draft.amount) : null;
  const dueDay = draft ? Number(draft.day) : 0;
  const missingText = draft ? needsDescription(draft.category, draft.description) : false;
  const ready = draft !== null && !missingText && cents !== null && cents > 0 && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31;

  // Tek açıklama alanı: boş bırakılırsa kategori adı başlık olur; "Diğer" bunu karşılamaz.
  const save = async () => {
    if (!draft || !ready || cents === null) return;
    const title = draft.description.trim() || (EXPENSE_CATEGORIES[draft.category] ?? draft.category);
    try {
      setFormError(null);
      if (draft.id) await updateRecurring(draft.id, title, draft.category, cents, dueDay);
      else await addRecurring(title, draft.category, cents, dueDay);
      setDraft(null);
    } catch (caught) {
      setFormError(errorText(caught));
    }
  };

  return (
    <Panel
      title="Sabit Giderler"
      aside={
        <Button variant="primary" className="min-h-12 text-sm" onClick={() => { setFormError(null); setDraft(EMPTY); }}>
          Sabit Gider Ekle
        </Button>
      }
    >
      {recurring.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Sabit gider yok.</p> : null}
      {recurring.length > 0 ? (
        <Field label="Ödeme şekli">
          <select
            value={payMethod}
            onChange={(event) => setPayMethod(event.target.value)}
            className="min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]"
          >
            <option value="BANK_TRANSFER">Havale</option>
            <option value="CREDIT_CARD">Kart</option>
            <option value="CASH">Nakit</option>
          </select>
        </Field>
      ) : null}
      <ul className="flex flex-col gap-1">
        {recurring.map((row) => {
          const paid = isPaid(row);
          return (
            <li key={row.id} className="flex items-center gap-2 min-h-12">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{row.title}</span>
                <span className={`block text-xs ${!paid && row.isOverdue ? 'font-bold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {EXPENSE_CATEGORIES[row.category] ?? row.category} · {paid ? 'Bu ay ödendi' : row.isOverdue ? `Ayın ${row.dueDay}. günü geçti` : `Ayın ${row.dueDay}. günü`}
                </span>
              </span>
              <span className="tabular-nums text-sm font-bold text-[var(--text-primary)]">{formatMoney(row.amountCents)}</span>
              <Button
                variant="secondary"
                className="min-h-12 text-sm"
                disabled={paid}
                onClick={() => void run(() => addExpense(row.category, row.amountCents, payMethod, row.title, row.id))}
              >
                Öde
              </Button>
              <Button
                variant="ghost"
                className="min-h-12 text-sm"
                onClick={() => {
                  setFormError(null);
                  setDraft({ id: row.id, category: row.category, description: row.title, amount: centsToText(row.amountCents), day: String(row.dueDay) });
                }}
              >
                Düzenle
              </Button>
              <Button variant="ghost" className="min-h-12 text-sm" onClick={() => void run(() => removeRecurring(row.id))}>
                Kaldır
              </Button>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}

      {draft ? (
        <Modal isOpen onClose={() => setDraft(null)} title={draft.id ? 'Sabit Gideri Düzenle' : 'Sabit Gider Ekle'} maxWidth="md">
          <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <CategorySelect value={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
            </Field>
            <Field label="Tutar (₺)">
              <NumberInput className="min-h-12 tabular-nums" value={draft.amount} onValueChange={(amount) => setDraft({ ...draft, amount })} />
            </Field>
            <Field label="Ödeme günü (ayın kaçı)">
              <NumberInput kind="integer" className="min-h-12 tabular-nums" value={draft.day} onValueChange={(day) => setDraft({ ...draft, day })} />
            </Field>
            <Field label={draft.category === 'OTHER' ? 'Açıklama (zorunlu)' : 'Açıklama'} wide>
              <Input
                value={draft.description}
                error={missingText}
                placeholder={EXPENSE_CATEGORIES[draft.category] ?? ''}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
          </div>
          {missingText ? <p className="text-xs font-semibold text-[var(--accent-red)]">"Diğer" için ne olduğunu yazın.</p> : null}
          {formError ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="min-h-12" onClick={() => setDraft(null)}>Vazgeç</Button>
            <Button variant="primary" className="min-h-12" disabled={!ready} onClick={() => void save()}>Kaydet</Button>
          </div>
          </div>
        </Modal>
      ) : null}
    </Panel>
  );
};
