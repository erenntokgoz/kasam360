import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { OrderItem } from '../../types/pos';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Numpad } from '../../ui/Numpad';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';

export interface SmartAuthModalProps {
  isOpen: boolean;
  item: OrderItem | null;
  mode: 'VOID' | 'COMP';
  onClose: () => void;
  onSuccess: (reason: string) => void;
}

export const SmartAuthModal: React.FC<SmartAuthModalProps> = ({ isOpen, item, mode, onClose, onSuccess }) => {
  const [reason, setReason] = useState('');
  const [pinDigits, setPinDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    setReason('');
    setPinDigits('');
    setError(null);
  }, [item?.id, mode]);

  if (!item) return null;

  // Kalem jetonla ve gerekçeyle yazılır; PIN doğrulanmadan ekrandan kalkmaz.
  const handleConfirm = async () => {
    setIsVerifying(true);
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      const approval = await invokeIPC<{ approvalToken: string }>('verify_manager_pin', {
        payload: {
          // Kalem ikramı sunucuda %100 indirim yüzeyidir.
          operation: mode === 'VOID' ? 'VOID_ORDER' : 'DISCOUNT',
          resourceId: item.id,
          actorId,
          actorRole,
          amountCents: item.lineTotalCents ?? item.totalCents,
          discountPercent: mode === 'COMP' ? 100 : 0,
          terminalId: 'terminal_pos',
          pin: pinDigits,
          tenantId,
        },
      });
      await invokeIPC(mode === 'VOID' ? 'void_order_item' : 'comp_order_item', {
        payload: { itemId: item.id, reason: reason.trim(), actorId, actorRole, approvalToken: approval.approvalToken },
        tenantId,
      });
      onSuccess(reason.trim());
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setPinDigits('');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'VOID' ? 'Kalem İptali' : 'İkram'}
      subtitle={`${item.name} (${item.quantity} Adet)`}
      maxWidth="md"
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="void-reason" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">
            Sebep
          </label>
          <Input id="void-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} autoFocus />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
            <ShieldCheck className="w-5 h-5" />
            <span>Yönetici PIN</span>
          </span>
          <span className="text-xl tabular-nums font-bold tracking-widest text-[var(--text-primary)]">
            {pinDigits ? pinDigits.replace(/./g, '•') : '----'}
          </span>
        </div>

        {error ? (
          <ErrorToast message={error} />
        ) : null}

        <Numpad
          onDigit={(digit) => setPinDigits((current) => (current.length < 8 ? current + digit : current))}
          onClear={() => setPinDigits('')}
          onBackspace={() => setPinDigits((current) => current.slice(0, -1))}
          buttonHeightClass="!min-h-14"
        />
        <Button variant="primary" size="lg" className="w-full" disabled={pinDigits.length < 4 || !reason.trim()} isLoading={isVerifying} onClick={() => void handleConfirm()}>
          Onayla
        </Button>
      </div>
    </Modal>
  );
};
