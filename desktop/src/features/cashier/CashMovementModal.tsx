import React, { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

export interface CashMovementModalProps {
  isOpen: boolean;
  type: 'IN' | 'OUT' | null;
  onClose: () => void;
  onSubmit: (type: 'IN' | 'OUT', cents: number, reason: string) => Promise<void>;
}

export const CashMovementModal: React.FC<CashMovementModalProps> = ({
  isOpen,
  type,
  onClose,
  onSubmit,
}) => {
  const [cashAmountLiras, setCashAmountLiras] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !type) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const liras = parseFloat(cashAmountLiras) || 0;
    const cents = Math.round(liras * 100);

    setIsSubmitting(true);
    try {
      await onSubmit(type, cents, cashReason);
      setCashAmountLiras('');
      setCashReason('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={type === 'IN' ? 'Kasaya Nakit Girişi' : 'Kasadan Nakit Çıkışı'}
      subtitle={
        type === 'IN'
          ? 'Kasaya eklenen nakit avansı veya para üstü desteğini kaydedin.'
          : 'Masraf, kurye ödemesi veya bankaya yatırılan nakit çıkışını kaydedin.'
      }
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Tutar (₺)
          </label>
          <Input
            type="number"
            min="1"
            step="1"
            value={cashAmountLiras}
            onChange={(e) => setCashAmountLiras(e.target.value)}
            placeholder="Örn: 250"
            className="text-base font-bold tabular-nums"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            İşlem Gerekçesi / Açıklama
          </label>
          <Input
            type="text"
            value={cashReason}
            onChange={(e) => setCashReason(e.target.value)}
            placeholder={type === 'IN' ? 'Örn: Bozuk para desteği' : 'Örn: Pazar alışverişi / Manav'}
            required
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Vazgeç
          </Button>
          <Button
            type="submit"
            variant={type === 'IN' ? 'success' : 'danger'}
            className="flex-1"
            isLoading={isSubmitting}
          >
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
};
