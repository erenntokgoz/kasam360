import React, { useState } from 'react';
import { formatDay } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { hoursText } from '../../../lib/payPeriod';
import { Button } from '../../../ui/Button';
import { Modal } from '../../../ui/Modal';
import { SettlementPayForm } from './SettlementPayForm';
import type { SessionSettlement } from './settlement';

type Step = 'ASK' | 'FULL' | 'PARTIAL' | 'DONE';

interface SettlementDialogProps {
  result: SessionSettlement;
  fullName: string;
  /** Pencere kapanınca; ödeme yapılmadıysa hesap borç olarak kalır. */
  onClose: () => void;
}

/** Çıkışta hesaplanan ücret ve "Ödeme yapıldı mı?" sorusu. Kapatmak yanıtsızlıktır: borç kalır. */
export const SettlementDialog: React.FC<SettlementDialogProps> = ({ result, fullName, onClose }) => {
  const [step, setStep] = useState<Step>('ASK');
  const [remaining, setRemaining] = useState<number | null>(result.settlement?.remainingCents ?? null);
  const settlement = result.settlement;

  if (!settlement) {
    return (
      <Modal cardFlow isOpen title={`Çıkış kaydedildi · ${fullName}`} maxWidth="sm" onClose={onClose}>
        <div className="space-y-3">
          {result.note ? <p className="text-sm text-[var(--text-secondary)]">{result.note}</p> : null}
          <Button type="button" variant="primary" className="w-full" onClick={onClose}>Tamam</Button>
        </div>
      </Modal>
    );
  }

  const earned = settlement.earnedCents;
  return (
    <Modal cardFlow isOpen title={`Ücret hesabı · ${fullName}`} subtitle={formatDay(settlement.workDate)} maxWidth="sm" onClose={onClose}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          {settlement.kind === 'HOURLY' ? (
            <div>
              <dt className="text-xs text-[var(--text-secondary)]">Çalışılan</dt>
              <dd className="text-sm font-semibold tabular-nums">{hoursText(settlement.workedSeconds)} saat</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">{settlement.kind === 'DAILY' ? 'Günlük ücret' : 'Ücret'}</dt>
            <dd className="text-sm font-semibold tabular-nums">{earned === null ? 'Gizli' : formatMoney(earned)}</dd>
          </div>
        </dl>
        {earned === null || remaining === null ? (
          <Button type="button" variant="primary" className="w-full" onClick={onClose}>Tamam</Button>
        ) : step === 'ASK' ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Ödeme yapıldı mı?</p>
            <Button type="button" variant="primary" className="w-full" onClick={() => setStep('FULL')}>Evet, tamamı ödendi</Button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => setStep('PARTIAL')}>Kısmen ödendi</Button>
            <Button type="button" variant="secondary" className="w-full" onClick={onClose}>Ödenmedi, borç kalsın</Button>
          </div>
        ) : step === 'DONE' ? (
          <div className="space-y-3">
            <p className="text-sm tabular-nums">{remaining > 0 ? `Kalan personel borcu ${formatMoney(remaining)}` : 'Borç kalmadı.'}</p>
            <Button type="button" variant="primary" className="w-full" onClick={onClose}>Tamam</Button>
          </div>
        ) : (
          <SettlementPayForm
            settlement={settlement}
            remainingCents={remaining}
            initialAmountCents={step === 'FULL' ? remaining : null}
            onPaid={(rest) => {
              setRemaining(rest);
              setStep('DONE');
            }}
          />
        )}
      </div>
    </Modal>
  );
};
