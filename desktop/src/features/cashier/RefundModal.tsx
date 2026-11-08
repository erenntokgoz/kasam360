import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { ManagerPinPrompt } from '../payment/ManagerPinPrompt';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export interface RefundTarget {
  transaction_id: string;
  order_id: string | null;
  total_cents: number;
  refunded_cents: number;
}

interface RefundModalProps {
  target: RefundTarget;
  initialReason?: string;
  onClose: () => void;
  onDone: () => void;
}

export const RefundModal: React.FC<RefundModalProps> = ({ target, initialReason = '', onClose, onDone }) => {
  const remaining = target.total_cents - target.refunded_cents;
  const [amountText, setAmountText] = useState((remaining / 100).toFixed(2).replace('.', ','));
  const [reason, setReason] = useState(initialReason);
  const [approving, setApproving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseCents(amountText);
  const valid = amountCents !== null && amountCents > 0 && amountCents <= remaining && reason.trim().length > 0;

  const refund = async (approvalToken: string) => {
    if (!valid || saving) return;
    setApproving(false);
    setSaving(true);
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('create_compensation_refund', {
        payload: {
          originalTransactionId: target.transaction_id,
          orderId: target.order_id,
          amountCents,
          reason: reason.trim(),
          actorId,
          actorRole,
          approvalToken,
        },
        tenantId,
      });
      onDone();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  if (approving && amountCents !== null) {
    return (
      <ManagerPinPrompt
        cardFlow
        title="İade onayı"
        scope={{ operation: 'REFUND', resourceId: target.transaction_id, amountCents }}
        onApproved={(token) => void refund(token)}
        onClose={() => setApproving(false)}
      />
    );
  }

  return (
    <Modal cardFlow isOpen onClose={() => { if (!saving) onClose(); }} title="Tahsilat iadesi" maxWidth="sm">
      <div className="space-y-3">
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-secondary)]">
          İade edilebilir: <span className="font-bold tabular-nums">{formatMoney(remaining)}</span>
        </p>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Tutar (₺)
          <NumberInput
            value={amountText}
            disabled={saving}
            onValueChange={setAmountText}
            className="mt-1 w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-base font-bold tabular-nums text-[var(--text-primary)]"
          />
        </label>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          İade nedeni
          <input
            value={reason}
            disabled={saving}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]"
          />
        </label>
        {amountCents !== null && amountCents > remaining ? (
          <p role="alert" className="text-sm font-semibold text-[var(--danger)]">
            Tutar iade edilebilir {formatMoney(remaining)} tutarını aşıyor.
          </p>
        ) : null}
        {error ? (
          <ErrorToast message={error} />
        ) : null}
        <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" disabled={saving} onClick={onClose}>Geri</Button>
          <Button type="button" variant="primary" disabled={!valid} isLoading={saving} onClick={() => setApproving(true)}>
            Yönetici Onayı
          </Button>
        </div>
      </div>
    </Modal>
  );
};
