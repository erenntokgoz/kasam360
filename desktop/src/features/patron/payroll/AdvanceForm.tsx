import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import type { PayrollRule } from './RuleEditor';

interface AdvanceFormProps {
  rules: PayrollRule[];
  period: string;
  onSaved: () => void;
}

const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

/** Avans gider olarak yazılır ve seçili dönemin bordrosundan düşer. */
export const AdvanceForm: React.FC<AdvanceFormProps> = ({ rules, period, onSaved }) => {
  const [userId, setUserId] = useState('');
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
      <span className="text-xs font-semibold text-[var(--text-secondary)]">Avans ({period})</span>
      <select aria-label="Avans personeli" className={fieldClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
        <option value="">Personel seçin</option>
        {rules.map((rule) => <option key={rule.userId} value={rule.userId}>{rule.fullName}</option>)}
      </select>
      <Input aria-label="Avans tutarı" inputMode="decimal" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-32" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select aria-label="Avans ödeme şekli" className={fieldClass} value={method} onChange={(event) => setMethod(event.target.value)}>
        <option value="CASH">Nakit</option>
        <option value="BANK_TRANSFER">Havale</option>
      </select>
      <Button variant="secondary" className="min-h-12 text-xs" disabled={userId === '' || cents === null || cents <= 0} onClick={() => void save()}>
        Avans Ver
      </Button>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </div>
  );
};
