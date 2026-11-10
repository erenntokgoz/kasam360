import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useId, useRef, useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { EXPENSE_CATEGORIES, EXPENSE_LABELS, needsDescription, useExpenseStore, type Expense } from '../../../stores/expenseStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';
import { formatInstantDay } from '../../../lib/date';

const monthOf = (offset: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const EXPENSE_METHODS = [
  { id: 'CASH', label: 'Nakit' },
  { id: 'CREDIT_CARD', label: 'Kart' },
  { id: 'BANK_TRANSFER', label: 'Havale' },
];

/** Görünür etiket: yer tutucu yazı alan dolunca kaybolur, ne girildiği unutulur. */
export const Field: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({ label, wide, children }) => (
  <label className={`flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)] ${wide ? 'col-span-2' : ''}`}>
    {label}
    {children}
  </label>
);

export const CategorySelect: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className="min-h-12 w-full px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]"
  >
    {Object.entries(EXPENSE_CATEGORIES).map(([id, label]) => (
      <option key={id} value={id}>{label}</option>
    ))}
  </select>
);

/** Dönem giderleri: ay tek yerden seçilir, toplam ve kanal kırılımı aynı listeden gelir. */
export const FinanceTab: React.FC = () => {
  const { period, setPeriod, expenses, error, load, addExpense, voidExpense, editExpense } = useExpenseStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [voidReason, setVoidReason] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const selected = expenses?.find((item) => item.id === selectedId);
  const cents = parseCents(amount);
  const missingText = needsDescription(category, note);
  const descriptionErrorId = useId();
  const ready = cents !== null && cents > 0 && !missingText;

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
    if (!ready || cents === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setFormError(null);
      if (editing) await editExpense(editing, category, cents, method, note.trim());
      else await addExpense(category, cents, method, note.trim());
      closeForm();
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const confirmVoid = async (id: string) => {
    if (inFlight.current || !voidReason.trim()) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setFormError(null);
      await voidExpense(id, voidReason.trim());
      setVoiding(false);
      setSelectedId(null);
      setVoidReason('');
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const openEdit = (item: Expense) => {
    setFormError(null);
    setEditing(item);
    setCategory(item.category);
    setAmount(centsToText(item.amountCents));
    setMethod(item.paymentMethod);
    setNote(item.description ?? '');
    setIsFormOpen(true);
  };

  const total = expenses?.reduce((sum, item) => sum + item.amountCents, 0) ?? 0;
  const totalOf = (method: string) => formatMoney(expenses?.filter((item) => item.paymentMethod === method).reduce((sum, item) => sum + item.amountCents, 0) ?? 0);

  return (
    <div className="space-y-4">
      {error ? (
        <ErrorToast message={`Giderler okunamadı: ${error}`} />
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
      <p className="text-xs text-[var(--text-secondary)]">
        Bu toplam işletme gideri kayıtlarını gösterir. Stok alımı burada gider sayılmaz; peşin alım ödeme kanalında, vadeli alım tedarikçi borcunda görünür. Alış maliyeti FIFO ile satışta “Satılan Malın Maliyeti”ne yansır.
      </p>

      {isFormOpen ? (
      <Modal cardFlow isOpen onClose={() => { if (!inFlight.current) closeForm(); }} title={editing ? 'Gideri Düzenle' : 'Gider Ekle'} maxWidth="md">
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <fieldset disabled={busy} className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <CategorySelect value={category} onChange={setCategory} />
            </Field>
            <Field label="Tutar (₺)">
              <NumberInput className="min-h-12 tabular-nums" value={amount} onValueChange={setAmount} />
            </Field>
            <Field label={category === 'OTHER' ? 'Açıklama (zorunlu)' : 'Açıklama'} wide>
              <Input className="min-h-12" error={missingText} aria-invalid={missingText} aria-describedby={missingText ? descriptionErrorId : undefined} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </fieldset>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ödeme şekli">
            {EXPENSE_METHODS.map((item) => (
              <Button key={item.id} type="button" disabled={busy} aria-pressed={method === item.id} variant={method === item.id ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setMethod(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
          {missingText ? <p id={descriptionErrorId} className="text-xs font-semibold text-[var(--accent-red)]">"Diğer" için ne olduğunu yazın.</p> : null}
          {formError ? <ErrorToast message={formError} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={closeForm}>Vazgeç</Button>
            <Button type="submit" variant="primary" disabled={!ready} isLoading={busy}>
              {editing ? 'Değişikliği Kaydet' : 'Kaydet'}
            </Button>
          </div>
        </form>
      </Modal>
      ) : null}

      <Panel
        title="Dönem Giderleri"
        aside={
          <Button
            variant="primary"
            className="min-h-12 text-sm"
            onClick={() => {
              setEditing(null);
              setCategory('OTHER');
              setMethod('CASH');
              setFormError(null);
              setIsFormOpen(true);
            }}
          >
            Gider Ekle
          </Button>
        }
      >
        {expenses?.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Bu dönemde gider yok.</p> : null}
        <ul className="grid gap-2 md:grid-cols-2">
          {expenses?.map((item) => (
            <li key={item.id}>
              <RecordCard title={EXPENSE_LABELS[item.category] ?? item.category}
                description={[formatInstantDay(item.expenseDate), item.description].filter(Boolean).join(' · ')}
                value={formatMoney(item.amountCents)} onOpen={() => {
                  setFormError(null);
                  setVoiding(false);
                  setSelectedId(item.id);
                }} />
            </li>
          ))}
        </ul>
      </Panel>
      {selected && !isFormOpen ? (
        <Modal cardFlow isOpen title={EXPENSE_LABELS[selected.category] ?? selected.category}
          subtitle={formatInstantDay(selected.expenseDate)} maxWidth="sm"
          onClose={() => { if (!inFlight.current) setSelectedId(null); }}>
          <div className="space-y-4">
            <div className="flex justify-between gap-3 text-sm">
              <span>{EXPENSE_METHODS.find((item) => item.id === selected.paymentMethod)?.label ?? selected.paymentMethod}</span>
              <strong className="tabular-nums">{formatMoney(selected.amountCents)}</strong>
            </div>
            {selected.description ? <p className="break-words text-sm">{selected.description}</p> : null}
            {formError ? <ErrorToast message={formError} /> : null}
            {voiding ? (
              <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void confirmVoid(selected.id); }}>
                <Field label="İptal nedeni">
                  <Input required disabled={busy} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={busy} onClick={() => { setVoiding(false); setFormError(null); }}>Vazgeç</Button>
                  <Button type="submit" variant="danger" disabled={!voidReason.trim()} isLoading={busy}>Gideri İptal Et</Button>
                </div>
              </form>
            ) : (
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => openEdit(selected)}>Düzenle</Button>
                <Button type="button" variant="danger" onClick={() => { setVoiding(true); setVoidReason(''); }}>İptal Et</Button>
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
};
