import { ErrorToast } from '../../ui/ErrorToast';
import { localDate } from '../../lib/cariInput';
import React, { useState } from 'react';
import { centsToText, parseCents } from '../../lib/moneyInput';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';

interface EditableDebt {
  id: string;
  totalAmountCents: number;
  dueDate?: string | null;
  description?: string | null;
}

interface CariEditDebtModalProps {
  debt: EditableDebt;
  onClose: () => void;
  onSaved: () => void;
}

export const CariEditDebtModal: React.FC<CariEditDebtModalProps> = ({ debt, onClose, onSaved }) => {
  const [amount, setAmount] = useState(centsToText(debt.totalAmountCents));
  const [dueDate, setDueDate] = useState(() => debt.dueDate?.slice(0, 10) || localDate(new Date()));
  const [description, setDescription] = useState(debt.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const cents = parseCents(amount);

  const save = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('update_debt', {
        actorRole,
        actorId,
        tenantId,
        operationId: crypto.randomUUID(),
        input: { debtId: debt.id, amountCents: cents, dueDate: dueDate || null, description: description.trim() || null },
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
      setIsBusy(false);
    }
  };

  return (
    <Modal cardFlow isOpen onClose={onClose} title="Kaydı Düzenle" maxWidth="sm">
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Tutar (₺)
          <NumberInput id="edit-debt-amount" className="min-h-12 mt-1" value={amount} onValueChange={setAmount} />
        </label>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Vade
          <Input type="date" className="min-h-12 mt-1" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Açıklama
          <Input className="min-h-12 mt-1" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {error ? <ErrorToast message={error} /> : null}
        <Button variant="primary" className="w-full min-h-12" disabled={cents === null || cents <= 0} isLoading={isBusy} onClick={() => void save()}>
          Kaydet
        </Button>
      </div>
    </Modal>
  );
};
