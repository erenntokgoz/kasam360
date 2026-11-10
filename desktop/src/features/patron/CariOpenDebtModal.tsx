import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { useCariStore } from '../../stores/cariStore';
import { localDate, newOperationId, parseCents } from '../../lib/cariInput';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { OperationFeedback, useOperationSubmit } from './CariOperationForm';
import type { DirectoryContact, OpenDebtType } from '../../types/ledger';

/** Pencere başlığı yapılan işlemi söyler; tür seçimi düğmede yapılmıştır. */
const TITLES: Record<OpenDebtType, string> = {
  GIVEN: 'Borç Yaz',
  TAKEN: 'Alacak Yaz',
};

interface CariOpenDebtModalProps {
  card: DirectoryContact;
  /** Boşsa pencere kapalıdır. */
  type: OpenDebtType | null;
  onClose: () => void;
  onOpened: () => void;
}

export const CariOpenDebtModal: React.FC<CariOpenDebtModalProps> = ({ card, type, onClose, onOpened }) => {
  const { openDebt } = useCariStore();
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(() => localDate(new Date()));
  const [description, setDescription] = useState('');
  const [operationId, setOperationId] = useState(newOperationId);
  const [inputError, setInputError] = useState<string | null>(null);
  const operation = useOperationSubmit(onOpened);

  useEffect(() => {
    if (!type) return;
    setAmount('');
    setDueDate(localDate(new Date()));
    setDescription('');
    setInputError(null);
    setOperationId(newOperationId());
  }, [type]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!type) return;
    const totalAmountCents = parseCents(amount);
    if (!totalAmountCents) {
      setInputError('Geçerli bir tutar girin.');
      return;
    }
    setInputError(null);
    void operation.run(operationId, () =>
      openDebt({
        operationId,
        directoryId: card.id,
        type,
        totalAmountCents,
        dueDate: dueDate || undefined,
        description: description.trim() || undefined,
      })
    ).then((outcome) => {
      if (outcome === 'REJECTED') setOperationId(newOperationId());
    });
  };

  return (
    <Modal cardFlow isOpen={type !== null} onClose={onClose} title={type ? TITLES[type] : ''} subtitle={card.name} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="debt-amount" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Tutar (₺)
            </label>
            <NumberInput
              id="debt-amount"
              value={amount}
              onValueChange={setAmount}
              className="tabular-nums min-h-12"
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="debt-due" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Vade
            </label>
            <Input
              id="debt-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="tabular-nums min-h-12"
            />
          </div>
        </div>
        <div>
          <label htmlFor="debt-note" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Açıklama
          </label>
          <Input id="debt-note" value={description} onChange={(event) => setDescription(event.target.value)} />
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
            variant="primary"
            isLoading={operation.isSaving}
            disabled={operation.pendingOperationId !== null}
            className="flex-1 min-h-12"
          >
            {type ? TITLES[type] : ''}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
