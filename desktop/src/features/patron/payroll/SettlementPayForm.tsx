import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useRef, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { createPrefixedId } from '../../../lib/prefixedId';
import { centsToText } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { NumberInput } from '../../../ui/NumberInput';
import { checkPayAmount, METHOD_LABEL, type PayMethod, type StaffSettlement } from './settlement';
import { refreshCashAfterPayout } from './refreshCash';
import { useOwnerApproval } from './useOwnerApproval';

interface SettlementPayFormProps {
  settlement: StaffSettlement;
  remainingCents: number;
  initialAmountCents: number | null;
  onPaid: (remainingCents: number) => void;
}

/**
 * Hesaba ödeme. İstek kimliği ödeme niyeti başına bir kez üretilir; hata sonrası aynı
 * kimlikle tekrar denemek ikinci gider yazmaz. Müdür için sahibin PIN'i istenir.
 */
export const SettlementPayForm: React.FC<SettlementPayFormProps> = ({ settlement, remainingCents, initialAmountCents, onPaid }) => {
  const [amount, setAmount] = useState(initialAmountCents === null ? '' : centsToText(initialAmountCents));
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const requestId = useRef(createPrefixedId('req'));
  const submitting = useRef(false);
  const approval = useOwnerApproval();
  const checked = checkPayAmount(amount, remainingCents);

  const pay = async () => {
    if (checked.cents === null || submitting.current) return;
    submitting.current = true;
    setIsBusy(true);
    setError(null);
    try {
      const decision = await approval.ask(
        { operation: 'PAYROLL_PAY', resourceId: `PAYROLL_PAY:${settlement.id}`, amountCents: checked.cents },
        'Personel ücreti ödemesi',
      );
      if (!decision.approved) return;
      const { actorId, actorRole, tenantId } = sessionArgs();
      const result = await invokeIPC<{ remainingCents: number }>('pay_staff_settlement', {
        tenantId, actorId, actorRole, settlementId: settlement.id, amountCents: checked.cents,
        paymentMethod: method, requestId: requestId.current, approvalToken: decision.token ?? null,
      });
      requestId.current = createPrefixedId('req');
      refreshCashAfterPayout();
      onPaid(result.remainingCents);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      submitting.current = false;
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold">
        Ödenen tutar · kalan {formatMoney(remainingCents)}
        <NumberInput aria-label="Ödenen tutar" className="mt-1 min-h-12 tabular-nums" value={amount} onValueChange={setAmount} />
      </label>
      {amount.trim() !== '' && checked.error ? <p role="alert" className="text-xs text-[var(--accent-red)]">{checked.error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {(['CASH', 'BANK_TRANSFER'] as const).map((item) => (
          <Button key={item} type="button" variant={method === item ? 'selected' : 'secondary'} onClick={() => setMethod(item)}>
            {METHOD_LABEL[item]}
          </Button>
        ))}
      </div>
      {error ? <ErrorToast message={error} /> : null}
      <Button type="button" variant="primary" className="w-full" disabled={checked.cents === null} isLoading={isBusy} onClick={() => void pay()}>
        Ödemeyi Kaydet
      </Button>
      {approval.prompt}
    </div>
  );
};
