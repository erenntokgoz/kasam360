import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { refreshCashAfterPayout } from './refreshCash';
import { useOwnerApproval } from './useOwnerApproval';

export type AdvanceMethod = 'CASH' | 'BANK_TRANSFER';

interface AdvanceFormProps {
  editing?: { expenseId: string; amountCents: number; paymentMethod: string } | null;
  onCancelEdit?: () => void;
  userId: string;
  period: string;
  onSaved: () => void;
}

/** Avans gider olarak yazılır ve seçili dönemin bordrosundan düşer. Nakit kasadan çıkar. */
export const AdvanceForm: React.FC<AdvanceFormProps> = ({ userId, period, editing, onCancelEdit, onSaved }) => {
  const [amount, setAmount] = useState(editing ? (editing.amountCents / 100).toFixed(2).replace('.', ',') : '');
  const [method, setMethod] = useState<AdvanceMethod>(editing?.paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH');
  const [error, setError] = useState<string | null>(null);
  const approval = useOwnerApproval();
  const cents = parseCents(amount);

  const save = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      // Avans kasadan ya da bankadan para çıkarır: müdür için sahibin PIN'i istenir.
      const decision = await approval.ask(
        {
          operation: 'STAFF_ADVANCE',
          resourceId: editing ? `STAFF_ADVANCE:${editing.expenseId}` : `STAFF_ADVANCE:${userId}:${period}`,
          amountCents: cents ?? 0,
        },
        'Personel avansı',
      );
      if (!decision.approved) return;
      const approvalToken = decision.token ?? null;
      // Düzeltme tek komuttur: iptal ve yeni kayıt birlikte yazılır, biri kalırsa çift kesinti olurdu.
      if (editing) {
        await invokeIPC('correct_staff_advance', {
          expenseId: editing.expenseId, period, amountCents: cents, paymentMethod: method, actorId, actorRole, tenantId, approvalToken,
        });
      } else {
        await invokeIPC('record_staff_advance', {
          userId, period, amountCents: cents, paymentMethod: method, actorId, actorRole, tenantId, approvalToken,
        });
      }
      setAmount('');
      refreshCashAfterPayout();
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2"><span className="text-sm font-semibold">Avans tutarı</span>
        <NumberInput aria-label="Avans tutarı" className="min-h-12 tabular-nums !w-32" value={amount} onValueChange={setAmount} />
      </label>
      <Button variant={method === 'CASH' ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setMethod('CASH')}>
        Nakit
      </Button>
      <Button variant={method === 'BANK_TRANSFER' ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setMethod('BANK_TRANSFER')}>
        Havale
      </Button>
      <Button variant="primary" className="min-h-12 text-sm font-bold" disabled={cents === null || cents <= 0} onClick={() => void save()}>
        {editing ? 'Kaydet' : 'Avans Ver'}
      </Button>
      {editing ? (
        <Button variant="ghost" className="min-h-12 text-sm" onClick={onCancelEdit}>
          Vazgeç
        </Button>
      ) : null}
      {error ? <ErrorToast message={error} /> : null}
      {approval.prompt}
    </div>
  );
};
