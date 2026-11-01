import React, { useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';

interface AdvanceFormProps {
  userId: string;
  period: string;
  onSaved: () => void;
}

const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

/** Avans gider olarak yazılır ve seçili dönemin bordrosundan düşer. */
export const AdvanceForm: React.FC<AdvanceFormProps> = ({ userId, period, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);

  const save = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('record_staff_advance', {
        userId, period, amountCents: cents, paymentMethod: method, actorId, actorRole, tenantId,
      });
      setAmount('');
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NumberInput aria-label="Avans tutarı" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-32" value={amount} onValueChange={setAmount} />
      <select aria-label="Avans ödeme şekli" className={fieldClass} value={method} onChange={(event) => setMethod(event.target.value)}>
        <option value="CASH">Nakit</option>
        <option value="BANK_TRANSFER">Havale</option>
      </select>
      <Button variant="secondary" className="min-h-12 text-sm" disabled={cents === null || cents <= 0} onClick={() => void save()}>
        Avans Ver
      </Button>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </div>
  );
};
