import React, { useRef, useState } from 'react';
import { Banknote, CreditCard } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { PinpadModal, type PinpadInfo } from '../../ui/PinpadModal';

export type TipMethod = 'CASH' | 'CARD';

export const TIP_METHOD_LABEL: Record<TipMethod, string> = { CASH: 'Nakit', CARD: 'Kart' };

interface TipDialogProps {
  info: PinpadInfo[];
  onSaved: (amountCents: number, method: TipMethod) => void;
  onClose: () => void;
}

/** Önce tutar, sonra yöntem. Bahşiş satışın parçası değildir, doğrudan havuza yazılır. */
export const TipDialog: React.FC<TipDialogProps> = ({ info, onSaved, onClose }) => {
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [saving, setSaving] = useState<TipMethod | null>(null);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  if (amountCents === null) {
    return (
      <PinpadModal
        title="Bahşiş Tutarı"
        kind="money"
        unit="₺"
        initial=""
        info={info}
        confirmLabel="Devam"
        onConfirm={(raw) => {
          const cents = parseCents(raw);
          if (cents) setAmountCents(cents);
        }}
        onClose={onClose}
      />
    );
  }

  const save = async (method: TipMethod) => {
    if (savingRef.current) return;
    const { actorId, actorRole, tenantId } = sessionArgs();
    savingRef.current = true;
    setSaving(method);
    setError(null);
    try {
      await invokeIPC('record_tip_entry', { amountCents, paymentMethod: method, actorId, actorRole, tenantId });
      onSaved(amountCents, method);
    } catch (caught) {
      setError(errorText(caught));
      savingRef.current = false;
      setSaving(null);
    }
  };

  return (
    <Modal isOpen onClose={() => { if (!savingRef.current) onClose(); }} title="Bahşiş Nasıl Alındı?" subtitle={`${formatMoney(amountCents)} bahşiş havuzuna yazılacak.`} maxWidth="sm">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="xl" isLoading={saving === 'CASH'} disabled={saving !== null} onClick={() => void save('CASH')}>
            <Banknote className="w-6 h-6" />
            <span>Nakit</span>
          </Button>
          <Button variant="secondary" size="xl" isLoading={saving === 'CARD'} disabled={saving !== null} onClick={() => void save('CARD')}>
            <CreditCard className="w-6 h-6" />
            <span>Kart</span>
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
      </div>
    </Modal>
  );
};
