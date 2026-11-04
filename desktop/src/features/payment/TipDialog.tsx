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
  onSaved: (amountCents: number, method: TipMethod, recipient: string | null) => void;
  onClose: () => void;
}

interface TipRecipient {
  id: string;
  name: string;
}

/** Bahşiş, tahsilattan bağımsız olarak seçilen alıcıya kaydedilir. */
export const TipDialog: React.FC<TipDialogProps> = ({ info, onSaved, onClose }) => {
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [saving, setSaving] = useState<TipMethod | null>(null);
  const [method, setMethod] = useState<TipMethod | null>(null);
  const [recipients, setRecipients] = useState<TipRecipient[] | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const attemptedRecipient = useRef<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
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

  const loadRecipients = async () => {
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setRecipients(await invokeIPC<TipRecipient[]>('list_tip_recipients', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const save = async (recipient: TipRecipient | null) => {
    if (savingRef.current || method === null) return;
    const target = recipient?.id ?? '';
    if (attemptedRecipient.current !== null && attemptedRecipient.current !== target) return;
    attemptedRecipient.current = target;
    const { actorId, actorRole, tenantId } = sessionArgs();
    savingRef.current = true;
    setSaving(method);
    setError(null);
    try {
      await invokeIPC('record_tip_entry', { amountCents, paymentMethod: method, recipientUserId: recipient?.id, requestId, actorId, actorRole, tenantId });
      onSaved(amountCents, method, recipient?.name ?? null);
    } catch (caught) {
      setError(errorText(caught));
      savingRef.current = false;
      setSaving(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!savingRef.current) onClose(); }}
      title={method ? 'Bahşiş Kime Yazılsın?' : 'Bahşiş Nasıl Alındı?'}
      subtitle={formatMoney(amountCents)}
      surface="work"
      maxWidth="sm"
    >
      <div className="space-y-3">
        {method ? (
          <>
            <Button variant="secondary" className="w-full" isLoading={saving !== null && attemptedRecipient.current === ''}
              disabled={saving !== null || !!attemptedRecipient.current} onClick={() => void save(null)}>Ortak Havuz</Button>
            {recipients === null ? (
              <Button variant="secondary" className="w-full" disabled={attemptedRecipient.current !== null}
                onClick={() => void loadRecipients()}>Personel Seç</Button>
            ) : (
              <>
                <label className="block">
                  <span className="block text-sm font-semibold">Personel</span>
                  <select className="w-full min-h-12" value={recipientId} disabled={attemptedRecipient.current !== null}
                    onChange={(event) => setRecipientId(event.target.value)}>
                    <option value="">{recipients.length ? 'Personel seçin' : 'Aktif personel yok'}</option>
                    {recipients.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <Button variant="primary" className="w-full" disabled={!recipientId || saving !== null || attemptedRecipient.current === ''}
                  isLoading={saving !== null && !!attemptedRecipient.current}
                  onClick={() => {
                    const recipient = recipients.find((person) => person.id === recipientId);
                    if (recipient) void save(recipient);
                  }}>Personele Kaydet</Button>
              </>
            )}
            {attemptedRecipient.current === null ? <Button variant="ghost" onClick={() => { setMethod(null); setError(null); }}>Geri</Button> : null}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="xl" onClick={() => setMethod('CASH')}>
              <Banknote className="w-6 h-6" />
              Nakit
            </Button>
            <Button variant="secondary" size="xl" onClick={() => setMethod('CARD')}>
              <CreditCard className="w-6 h-6" />
              Kart
            </Button>
          </div>
        )}
        {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
      </div>
    </Modal>
  );
};
