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
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseCents(amountText);
  const valid = amountCents !== null && amountCents > 0 && amountCents <= remaining && reason.trim().length > 0;

  const refund = async (approvalToken: string) => {
    setApproving(false);
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
    }
  };

  if (approving && amountCents !== null) {
    return (
      <ManagerPinPrompt
        title="İade onayı"
        scope={{ operation: 'REFUND', resourceId: target.transaction_id, amountCents }}
        onApproved={(token) => void refund(token)}
        onClose={() => setApproving(false)}
      />
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Tahsilat iadesi" maxWidth="sm">
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">
          İade edilebilir: <span className="font-bold tabular-nums">{formatMoney(remaining)}</span>
        </p>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Tutar (₺)
          <NumberInput
            value={amountText}
            onValueChange={setAmountText}
            className="mt-1 w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-base font-bold tabular-nums text-[var(--text-primary)]"
          />
        </label>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          İade nedeni
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]"
          />
        </label>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {error}
          </p>
        ) : null}
        <Button variant="primary" className="w-full min-h-12" disabled={!valid} onClick={() => setApproving(true)}>
          Yönetici onayına gönder
        </Button>
      </div>
    </Modal>
  );
};
