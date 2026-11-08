import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { parseCents } from '../../lib/moneyInput';

interface CashMovementFormProps {
  type: 'IN' | 'OUT';
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onBack: () => void;
  onSaved: () => void;
  onSubmit: (type: 'IN' | 'OUT', cents: number, reason: string) => Promise<void>;
}

export function CashMovementForm({ type, busy, setBusy, onBack, onSaved, onSubmit }: CashMovementFormProps) {
  const [cashAmountLiras, setCashAmountLiras] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseCents(cashAmountLiras);
    const reason = cashReason.trim();
    if (busy || cents === null || cents <= 0 || !reason) return;

    setError(null);
    setBusy(true);
    try {
      await onSubmit(type, cents, reason);
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="cash-movement-amount" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
          Tutar (₺)
        </label>
        <NumberInput
          id="cash-movement-amount"
          disabled={busy}
          value={cashAmountLiras}
          onValueChange={setCashAmountLiras}
          className="text-base font-bold tabular-nums"
          required
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="cash-movement-reason" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
          Gerekçe
        </label>
        <Input
          id="cash-movement-reason"
          disabled={busy}
          type="text"
          value={cashReason}
          onChange={(e) => setCashReason(e.target.value)}
          required
        />
      </div>

      {error && <ErrorToast message={error} />}
      <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
          Geri
        </Button>
        <Button
          type="submit"
          variant={type === 'IN' ? 'success' : 'danger'}
          isLoading={busy}
        >
          Kaydet
        </Button>
      </div>
    </form>
  );
}
