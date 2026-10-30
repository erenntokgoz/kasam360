import React, { useEffect, useState } from 'react';
import { useCariStore, type OpenDebtInput } from '../../stores/cariStore';
import { newOperationId, parseCents } from '../../lib/cariInput';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { OperationFeedback, useOperationSubmit } from './CariOperationForm';
import type { DirectoryContact } from '../../types/ledger';

interface CariOpenDebtModalProps {
  card: DirectoryContact;
  isOpen: boolean;
  onClose: () => void;
  onOpened: () => void;
}

export const CariOpenDebtModal: React.FC<CariOpenDebtModalProps> = ({
  card,
  isOpen,
  onClose,
  onOpened,
}) => {
  const { openDebt } = useCariStore();
  const [type, setType] = useState<OpenDebtInput['type']>('GIVEN');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [operationId, setOperationId] = useState(newOperationId);
  const [inputError, setInputError] = useState<string | null>(null);
  const operation = useOperationSubmit(onOpened);

  useEffect(() => {
    if (!isOpen) return;
    setType(card.type === 'SUPPLIER' ? 'TAKEN' : 'GIVEN');
    setAmount('');
    setDueDate('');
    setDescription('');
    setInputError(null);
    setOperationId(newOperationId());
  }, [isOpen, card.type]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
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
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Borç / Alacak Aç" subtitle={card.name} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={type === 'GIVEN' ? 'primary' : 'secondary'}
            aria-pressed={type === 'GIVEN'}
            onClick={() => setType('GIVEN')}
            className="min-h-12"
          >
            Alacağımız
          </Button>
          <Button
            type="button"
            variant={type === 'TAKEN' ? 'primary' : 'secondary'}
            aria-pressed={type === 'TAKEN'}
            onClick={() => setType('TAKEN')}
            className="min-h-12"
          >
            Borcumuz
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="debt-amount" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Tutar (₺)
            </label>
            <Input
              id="debt-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
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
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
};
