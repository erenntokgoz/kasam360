import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useRef, useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, monthKey, useExpenseStore, type RecurringRow } from '../../../stores/expenseStore';
import { useUIStore } from '../../../stores/uiStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { Panel } from '../panorama/Panel';
import { EXPENSE_METHODS, Field } from './FinanceTab';
import { RecordCard } from '../RecordCard';

interface Draft {
  id: string | null;
  category: string;
  description: string;
  amount: string;
  day: string;
}

const EMPTY: Draft = { id: null, category: 'OTHER', description: '', amount: '', day: '1' };

/** Ödeme aynı başlıkla gider yazar; bu ay ödenip ödenmediği oradan anlaşılır. */
export const RecurringPanel: React.FC = () => {
  const { period, recurring, expenses, addRecurring, removeRecurring, updateRecurring, addExpense } = useExpenseStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [payment, setPayment] = useState<RecurringRow | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setError(null);
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const selected = recurring.find((row) => row.id === selectedId);
  const canPayThisPeriod = period === monthKey();
  const isPaid = (row: RecurringRow) => expenses?.some((item) => item.recurringId === row.id || (item.recurringId === null && item.description === row.title)) ?? false;

  const cents = draft ? parseCents(draft.amount) : null;
  const dueDay = draft ? Number(draft.day) : 0;
  const missingText = draft ? draft.description.trim() === '' : false;
  const ready = draft !== null && !missingText && cents !== null && cents > 0 && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31;

  const save = async () => {
    if (!draft || !ready || cents === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const title = draft.description.trim();
    try {
      setFormError(null);
      if (draft.id) await updateRecurring(draft.id, title, draft.category, cents, dueDay);
      else await addRecurring(title, draft.category, cents, dueDay);
      setDraft(null);
      useUIStore.getState().showNotice('Sabit gider kaydedildi.');
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Sabit Giderler"
      aside={
        <Button variant="primary" className="min-h-12 text-sm" onClick={() => { setFormError(null); setDraft({ ...EMPTY, day: String(new Date().getDate()) }); }}>
          Sabit Gider Ekle
        </Button>
      }
    >
      {recurring.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Sabit gider yok.</p> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {recurring.map((row) => (
          <li key={row.id}>
            <RecordCard title={row.title}
              description={isPaid(row) ? 'Bu ay ödendi' : row.isOverdue ? `Ayın ${row.dueDay}. günü geçti` : `Ayın ${row.dueDay}. günü`}
              value={formatMoney(row.amountCents)} onOpen={() => {
                setError(null);
                setRemoving(false);
                setSelectedId(row.id);
              }} />
          </li>
        ))}
      </ul>

      {selected && !draft && !payment ? (
        <Modal cardFlow isOpen title={selected.title} subtitle={EXPENSE_CATEGORIES[selected.category] ?? selected.category}
          maxWidth="sm" onClose={() => { if (!inFlight.current) setSelectedId(null); }}>
          <div className="space-y-4">
            <div className="flex justify-between gap-3 text-sm">
              <span>Ayın {selected.dueDay}. günü{isPaid(selected) ? ' · Ödendi' : ''}</span>
              <strong className="tabular-nums">{formatMoney(selected.amountCents)}</strong>
            </div>
            {error ? <ErrorToast message={error} /> : null}
            {removing ? (
              <>
                <p className="text-sm">Sabit gider kaldırılsın mı?</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={busy} onClick={() => { setRemoving(false); setError(null); }}>Vazgeç</Button>
                  <Button type="button" variant="danger" isLoading={busy} onClick={() => void run(async () => {
                    await removeRecurring(selected.id);
                    setSelectedId(null);
                  })}>Kaldır</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" disabled={isPaid(selected) || !canPayThisPeriod}
                  title={!canPayThisPeriod ? 'Ödeme için içinde bulunduğunuz ayı seçin.' : undefined}
                  onClick={() => { setError(null); setPayMethod('BANK_TRANSFER'); setPayment(selected); }}>Öde</Button>
                <Button type="button" onClick={() => {
                  setFormError(null);
                  setDraft({ id: selected.id, category: selected.category, description: selected.title, amount: centsToText(selected.amountCents), day: String(selected.dueDay) });
                }}>Düzenle</Button>
                <Button type="button" variant="danger" onClick={() => setRemoving(true)}>Kaldır</Button>
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {payment ? (
        <Modal cardFlow isOpen onClose={() => { if (!inFlight.current) { setError(null); setPayment(null); } }} title="Sabit Gideri Öde"
          subtitle={`${payment.title} · ${formatMoney(payment.amountCents)}`} maxWidth="sm">
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (!canPayThisPeriod || isPaid(payment)) return;
            void run(async () => {
              await addExpense(payment.category, payment.amountCents, payMethod, payment.title, payment.id);
              setPayment(null);
              useUIStore.getState().showNotice('Sabit gider ödemesi kaydedildi.');
            });
          }}>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ödeme şekli">
              {EXPENSE_METHODS.map((item) => (
                <Button key={item.id} type="button" disabled={busy} aria-pressed={payMethod === item.id}
                  variant={payMethod === item.id ? 'selected' : 'secondary'} onClick={() => setPayMethod(item.id)}>{item.label}</Button>
              ))}
            </div>
            {error ? <ErrorToast message={error} /> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => { setError(null); setPayment(null); }}>Geri</Button>
              <Button type="submit" variant="primary" isLoading={busy} disabled={!canPayThisPeriod || isPaid(payment)}>Ödemeyi Kaydet</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {draft ? (
        <Modal cardFlow isOpen onClose={() => { if (!inFlight.current) setDraft(null); }} title={draft.id ? 'Sabit Gideri Düzenle' : 'Sabit Gider Ekle'} maxWidth="md">
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={busy} className="grid grid-cols-2 gap-3">
            <Field label="Tutar (₺)">
              <NumberInput className="min-h-12 tabular-nums" value={draft.amount} onValueChange={(amount) => setDraft({ ...draft, amount })} />
            </Field>
            <Field label="Ödeme günü (ayın kaçı)">
              <NumberInput kind="integer" className="min-h-12 tabular-nums" value={draft.day} onValueChange={(day) => setDraft({ ...draft, day })} />
            </Field>
            <Field label="Açıklama" wide>
              <Input
                value={draft.description}
                error={missingText}
                required
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
          </fieldset>
          {missingText ? <p className="text-xs font-semibold text-[var(--accent-red)]">Gider açıklamasını yazın.</p> : null}
          {formError ? <ErrorToast message={formError} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Vazgeç</Button>
            <Button type="submit" variant="primary" disabled={!ready} isLoading={busy}>Kaydet</Button>
          </div>
          </form>
        </Modal>
      ) : null}
    </Panel>
  );
};
