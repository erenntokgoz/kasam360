import React, { useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import type { OrderItem } from '../../types/pos';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
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

export const SmartAuthModal: React.FC<SmartAuthModalProps> = ({
  isOpen,
  item,
  mode,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState('Müşteri Vazgeçti');
  const [pinDigits, setPinDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!item) return null;

  const reasons =
    mode === 'VOID'
      ? ['Müşteri Vazgeçti', 'Hatalı Giriş', 'Mutfak Zayi', 'Geç Servis']
      : ['Müdür İkramı', 'Müşteri Memnuniyeti', 'Hediye / Tadım', 'Personel İkramı'];

  const handleDigit = (d: string) => {
    if (pinDigits.length < 8) setPinDigits((current) => current + d);
  };

  // Sunucuya gitmiş kalemde iptal jetonla ve gerekçeyle yazılır; PIN doğrulanmadan
  // kalem ekrandan kalkmaz.
  const handleConfirm = async () => {
    setIsVerifying(true);
    setError(null);
    try {
      if (item.isSentToKitchen) {
        const { actorId, actorRole, tenantId } = sessionArgs();
        const approval = await invokeIPC<{ approvalToken: string }>('verify_manager_pin', {
          payload: {
            operation: mode === 'VOID' ? 'VOID_ORDER' : 'COMPLIMENTARY',
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
          payload: { itemId: item.id, reason, actorId, actorRole, approvalToken: approval.approvalToken },
          tenantId,
        });
      }
      setPinDigits('');
      onSuccess(reason);
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setPinDigits('');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClear = () => setPinDigits('');
  const handleBackspace = () => setPinDigits((prev) => prev.slice(0, -1));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'VOID' ? 'Kalem İptali Onayı' : 'İkram Onayı'}
      subtitle={`${item.name} (${item.quantity} Adet)`}
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* İşlem Gerekçesi Seçimi */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[var(--text-secondary)]">
            İşlem Gerekçesi
          </label>
          <div className="grid grid-cols-2 gap-2">
            {reasons.map((r) => (
              <Button
                key={r}
                type="button"
                variant={reason === r ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setReason(r)}
                className="!min-h-[40px] text-xs font-semibold"
              >
                {r}
              </Button>
            ))}
          </div>
        </div>

        {/* PIN Doğrulama Alanı */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-amber)]" />
              <span>Yönetici veya işletme sahibi PIN kodu</span>
            </span>
            <span className="text-sm font-mono font-bold tracking-widest text-[var(--text-primary)]">
              {pinDigits ? pinDigits.replace(/./g, '•') : '----'}
            </span>
          </div>

          {error ? (
            <div className="p-2 rounded-lg text-xs font-medium text-center bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)] flex items-center justify-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{error}</span>
            </div>
          ) : null}

          <Numpad
            onDigit={handleDigit}
            onClear={handleClear}
            onBackspace={handleBackspace}
            buttonHeightClass="!min-h-12"
          />
          <Button type="button" variant="primary" className="w-full min-h-12" disabled={pinDigits.length < 4} isLoading={isVerifying} onClick={() => void handleConfirm()}>
            Onayla
          </Button>
        </div>

      </div>
    </Modal>
  );
};
