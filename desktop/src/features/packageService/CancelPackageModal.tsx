import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { orderCode } from '../../lib/packageModel';
import { usePackageStore } from '../../stores/packageStore';
import type { PackageDelivery } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { Numpad } from '../../ui/Numpad';

interface CancelPackageModalProps {
  delivery: PackageDelivery;
  onClose: () => void;
  onDone: () => void;
}

/** İptal gerekçe ve yönetici PIN'i ister; hata pencerede kalır, girilen gerekçe silinmez. */
export const CancelPackageModal: React.FC<CancelPackageModalProps> = ({ delivery, onClose, onDone }) => {
  const cancel = usePackageStore((state) => state.cancel);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const confirm = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await cancel(delivery, reason, pin);
      onDone();
    } catch (caught) {
      setError(errorText(caught));
      setPin('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!isBusy) onClose(); }}
      title="Paket siparişini iptal et"
      subtitle={`#${orderCode(delivery.id)} · ${delivery.customerName} · ${formatMoney(delivery.totalCents)}`}
      maxWidth="md"
      cardFlow
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="package-cancel-reason" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">Neden</label>
          <Input id="package-cancel-reason" value={reason} maxLength={200} autoFocus onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]">
            <ShieldCheck className="size-5" aria-hidden="true" />Yönetici PIN
          </span>
          <span className="text-xl font-bold tabular-nums tracking-widest">{pin ? pin.replace(/./g, '•') : '----'}</span>
        </div>
        {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
        <Numpad
          onDigit={(digit) => setPin((current) => (current.length < 8 ? current + digit : current))}
          onClear={() => setPin('')}
          onBackspace={() => setPin((current) => current.slice(0, -1))}
          buttonHeightClass="!min-h-14"
        />
        <Button variant="danger" size="lg" className="w-full" disabled={pin.length < 4 || !reason.trim()} isLoading={isBusy} onClick={() => void confirm()}>
          İptal et
        </Button>
      </div>
    </Modal>
  );
};
