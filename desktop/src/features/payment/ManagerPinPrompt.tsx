import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Numpad } from '../../ui/Numpad';

export interface ApprovalScope {
  operation: 'DISCOUNT' | 'COMPLIMENTARY' | 'VOID_ORDER' | 'REFUND' | 'CASH_OUT' | 'PAYROLL_PAY' | 'PAYROLL_RULE' | 'STAFF_ADVANCE';
  resourceId: string;
  amountCents: number;
  discountPercent?: number;
}

/** Onayı yalnız işletme sahibinden kabul edilen para çıkışı işlemleri. */
const OWNER_ONLY: ApprovalScope['operation'][] = ['CASH_OUT', 'PAYROLL_PAY', 'PAYROLL_RULE', 'STAFF_ADVANCE'];

interface ManagerPinPromptProps {
  scope: ApprovalScope;
  cardFlow?: boolean;
  title: string;
  onApproved: (approvalToken: string) => void;
  onClose: () => void;
}

/** Yönetici PIN'ini sunucuda doğrular. PIN saklanmaz; kapsamlı tek kullanımlık jeton döner. */
export const ManagerPinPrompt: React.FC<ManagerPinPromptProps> = ({ scope, title, onApproved, onClose, cardFlow }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const verify = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      const reply = await invokeIPC<{ approvalToken: string }>('verify_manager_pin', {
        payload: {
          ...scope,
          discountPercent: scope.discountPercent ?? 0,
          actorId,
          actorRole,
          tenantId,
          pin,
          terminalId: 'terminal_payment',
        },
      });
      onApproved(reply.approvalToken);
    } catch (caught) {
      setError(errorText(caught));
      setPin('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal cardFlow={cardFlow} isOpen onClose={() => { if (!isBusy) onClose(); }} title={title} maxWidth="sm">
      <div className="space-y-3">
        <p className="text-xs flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ShieldCheck className="w-4 h-4 text-[var(--text-secondary)]" />
          <span>{OWNER_ONLY.includes(scope.operation) ? 'Yalnız işletme sahibi PIN kodu' : 'Yönetici veya işletme sahibi PIN kodu'}</span>
        </p>
        <div aria-label="Girilen hane sayısı" className="h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center text-xl font-bold tracking-[0.4em] text-[var(--text-primary)]">
          {'•'.repeat(pin.length)}
        </div>
        {error ? (
          <ErrorToast message={error} />
        ) : null}
        <Numpad
          onDigit={(digit) => {
            if (pin.length < 8) setPin((current) => current + digit);
          }}
          onClear={() => setPin('')}
          onBackspace={() => setPin((current) => current.slice(0, -1))}
        />
        <Button type="button" variant="primary" className="w-full min-h-12" disabled={pin.length < 4} isLoading={isBusy} onClick={() => void verify()}>
          Onayla
        </Button>
      </div>
    </Modal>
  );
};
