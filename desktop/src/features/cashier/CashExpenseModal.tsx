import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { parseCents } from '../../lib/moneyInput';
import { createExpense, EXPENSE_CATEGORIES } from '../../stores/expenseStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

interface CashExpenseModalProps {
  onClose: () => void;
  onSaved: () => void;
}

/** Kasadan ödenen gider Finans ile aynı komuttan geçer: kârdan ve kasadan birlikte düşer. */
export const CashExpenseModal: React.FC<CashExpenseModalProps> = ({ onClose, onSaved }) => {
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);

  const save = async () => {
    if (cents === null || cents <= 0) return;
    setError(null);
    try {
      await createExpense(category, cents, 'CASH', note.trim());
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Kasadan Gider Öde" maxWidth="sm">
      <div className="space-y-3">
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
        <Input aria-label="Gider tutarı" inputMode="decimal" placeholder="Tutar (₺)" className="min-h-12 tabular-nums" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Input aria-label="Gider açıklaması" placeholder="Açıklama" className="min-h-12" value={note} onChange={(event) => setNote(event.target.value)} />
        {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 min-h-12" onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" className="flex-1 min-h-12" disabled={cents === null || cents <= 0} onClick={() => void save()}>Gideri Kaydet</Button>
        </div>
      </div>
    </Modal>
  );
};
