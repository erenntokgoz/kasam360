import { useUIStore } from '../../stores/uiStore';
import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { useCariStore, type PaymentInput } from '../../stores/cariStore';
import { newOperationId, parseCents } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { OperationFeedback, useOperationSubmit } from './CariOperationForm';
import type { LedgerDebt } from '../../types/ledger';

const METHODS: Array<{ id: PaymentInput['paymentMethod']; label: string }> = [
  { id: 'CASH', label: 'Nakit' },
  { id: 'CREDIT_CARD', label: 'Kart' },
  { id: 'BANK_TRANSFER', label: 'Havale' },
];

interface CariPaymentModalProps {
  debt: LedgerDebt | null;
  onClose: () => void;
  onPaid: () => void;
}

export const CariPaymentModal: React.FC<CariPaymentModalProps> = ({ debt, onClose, onPaid }) => {
  const { payDebt } = useCariStore();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentInput['paymentMethod']>('CASH');
  const [operationId, setOperationId] = useState(newOperationId);
  const [inputError, setInputError] = useState<string | null>(null);
  const operation = useOperationSubmit(() => {
    useUIStore.getState().showNotice(debt?.type === 'TAKEN' ? 'Tediye kaydedildi.' : 'Tahsilat kaydedildi.');
    onPaid();
  });

  useEffect(() => {
    if (!debt) return;
    setAmount(formatMoney(debt.remainingAmountCents).replace(' ₺', ''));
    setMethod('CASH');
    setInputError(null);
    setOperationId(newOperationId());
  }, [debt]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!debt) return;
    const amountCents = parseCents(amount);
    if (!amountCents) {
      setInputError('Geçerli bir tutar girin.');
      return;
    }
    if (amountCents > debt.remainingAmountCents) {
      setInputError('Tutar kalan bakiyeyi aşamaz.');
      return;
    }
    setInputError(null);
    void operation.run(operationId, () =>
      payDebt({
        operationId,
        debtId: debt.id,
        expectedVersion: debt.version,
        amountCents,
        paymentMethod: method,
      })
    );
  };

  // Sonuç bilinmezken yeni deneme ikinci ödeme riski taşır.
  const isLocked = operation.pendingOperationId !== null;

  return (
    <Modal
      isOpen={debt !== null}
      onClose={onClose}
      title={debt?.type === 'TAKEN' ? 'Tediye' : 'Tahsilat'}
      subtitle={debt ? `Kalan: ${formatMoney(debt.remainingAmountCents)}` : undefined}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="pay-amount" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Tutar (₺)
          </label>
          <NumberInput
            id="pay-amount"
            value={amount}
            onValueChange={setAmount}
            disabled={isLocked}
            className="text-base font-bold tabular-nums min-h-12"
            autoFocus
            required
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={method === item.id ? 'selected' : 'secondary'}
              aria-pressed={method === item.id}
              disabled={isLocked}
              onClick={() => setMethod(item.id)}
              className="min-h-12"
            >
              {item.label}
            </Button>
          ))}
        </div>
        {inputError ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {inputError}
          </p>
        ) : null}
        <OperationFeedback
          error={operation.error}
          pendingOperationId={operation.pendingOperationId}
          isSaving={operation.isSaving}
          onCheck={() => void operation.checkResult()}
        />
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1 min-h-12">
            Kapat
          </Button>
          <Button
            type="submit"
            variant="success"
            isLoading={operation.isSaving}
            disabled={isLocked}
            className="flex-1 min-h-12"
          >
            Ödemeyi Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
};
