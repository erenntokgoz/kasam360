import { ErrorToast } from '../../ui/ErrorToast';
import { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { parseCents } from '../../lib/moneyInput';
import { createExpense, EXPENSE_CATEGORIES, needsDescription } from '../../stores/expenseStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { useUIStore } from '../../stores/uiStore';

interface CashExpenseFormProps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onBack: () => void;
  onSaved: () => void;
}

/** Kasadan ödenen gider Finans ile aynı komuttan geçer: kârdan ve kasadan birlikte düşer. */
export function CashExpenseForm({ busy, setBusy, onBack, onSaved }: CashExpenseFormProps) {
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);
  const canSave = cents !== null && cents > 0 && !needsDescription(category, note);

  const save = async () => {
    if (!canSave || busy) return;
    setError(null);
    setBusy(true);
    try {
      await createExpense(category, cents, 'CASH', note.trim());
      useUIStore.getState().showNotice('Kasa gideri kaydedildi.');
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="space-y-3">
        <select
          aria-label="Gider kategorisi"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]"
        >
          {Object.entries(EXPENSE_CATEGORIES).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <label className="block space-y-1"><span className="text-sm font-semibold">Tutar</span>
          <NumberInput aria-label="Gider tutarı" className="min-h-12 tabular-nums" value={amount} onValueChange={setAmount} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">{category === 'OTHER' ? 'Açıklama (zorunlu)' : 'Açıklama'}</span>
          <Input required={category === 'OTHER'} className="min-h-12" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </fieldset>
      {error ? <ErrorToast message={error} /> : null}
      <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
        <Button type="button" disabled={busy} onClick={onBack}>Geri</Button>
        <Button type="submit" variant="primary" disabled={!canSave} isLoading={busy}>Gideri Kaydet</Button>
      </div>
    </form>
  );
}
