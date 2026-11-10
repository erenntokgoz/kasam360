import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorCode, errorText } from '../../lib/cariInput';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { parseCents } from '../../lib/moneyInput';
import { createPrefixedId } from '../../lib/prefixedId';
import { ManagerPinPrompt } from '../payment/ManagerPinPrompt';
import { useAuthStore } from '../../stores/authStore';
import { useShiftStore } from '../../stores/shiftStore';

interface CashMovementFormProps {
  type: 'IN' | 'OUT';
  busy: boolean;
  setBusy: (busy: boolean) => void;
  uncertain: boolean;
  setUncertain: (uncertain: boolean) => void;
  onBack: () => void;
  onSaved: () => void;
  onSubmit: (type: 'IN' | 'OUT', cents: number, reason: string, movementId: string, approvalToken?: string) => Promise<void>;
}

export function CashMovementForm({ type, busy, setBusy, uncertain, setUncertain, onBack, onSaved, onSubmit }: CashMovementFormProps) {
  const [movementId] = useState(() => createPrefixedId(type === 'IN' ? 'cmin' : 'cmout'));
  const [cashAmountLiras, setCashAmountLiras] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<{ cents: number; reason: string } | null>(null);
  const [retryApprovalToken, setRetryApprovalToken] = useState<string | undefined>();
  const role = useAuthStore((state) => state.user?.role);
  const shiftId = useShiftStore((state) => state.activeShift?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseCents(cashAmountLiras);
    const reason = cashReason.trim();
    if (busy || cents === null || cents <= 0 || !reason) return;

    setError(null);
    if (uncertain) {
      await save(cents, reason, retryApprovalToken);
      return;
    }
    if (type === 'OUT' && role === 'MANAGER') {
      setApproving({ cents, reason });
      return;
    }
    await save(cents, reason);
  };

  const save = async (cents: number, reason: string, approvalToken?: string) => {
    setBusy(true);
    setUncertain(false);
    try {
      await onSubmit(type, cents, reason, movementId, approvalToken);
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
      const isUncertain = errorCode(caught) === null;
      setUncertain(isUncertain);
      if (!isUncertain) setRetryApprovalToken(undefined);
    } finally {
      setBusy(false);
    }
  };

  if (approving && shiftId) {
    return <ManagerPinPrompt
      cardFlow
      title="Nakit çıkışı için işletme sahibi onayı"
      scope={{ operation: 'CASH_OUT', resourceId: `CASH_OUT:${shiftId}:${movementId}`, amountCents: approving.cents }}
      onApproved={(token) => { setRetryApprovalToken(token); setApproving(null); void save(approving.cents, approving.reason, token); }}
      onClose={() => setApproving(null)}
    />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="cash-movement-amount" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
          Tutar (₺)
        </label>
        <NumberInput
          id="cash-movement-amount"
          disabled={busy || uncertain}
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
          disabled={busy || uncertain}
          type="text"
          value={cashReason}
          onChange={(e) => setCashReason(e.target.value)}
          required
        />
      </div>

      {error && <ErrorToast message={error} />}
      <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy || uncertain}>
          Geri
        </Button>
        <Button
          type="submit"
          variant={type === 'IN' ? 'success' : 'danger'}
          isLoading={busy}
        >
          {uncertain ? 'Aynı İşlemi Yeniden Dene' : 'Kaydet'}
        </Button>
      </div>
    </form>
  );
}
