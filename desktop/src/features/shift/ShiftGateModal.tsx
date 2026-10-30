import React, { useState } from 'react';
import { useShiftStore } from '../../stores/shiftStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

export const ShiftGateModal: React.FC = () => {
  const { user } = useAuthStore();
  const { openShift, activeShift, shiftError } = useShiftStore();
  const { modals, closeModal } = useUIStore();

  const [openingLira, setOpeningLira] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOpen = modals.shiftGate || (!activeShift?.isOpen && modals.payment);

  const handlePreset = (val: number) => {
    setOpeningLira(val.toString());
  };

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseMoneyToCents(openingLira);

    setIsSubmitting(true);
    const success = await openShift(cents, user?.userId || 'usr_cashier', user?.name || 'Kasiyer');
    setIsSubmitting(false);

    if (success) {
      closeModal('shiftGate');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => closeModal('shiftGate')}
      title="Vardiya Açılışı"
      subtitle="Satış yapabilmek için kasa çekmecesindeki nakit tutarını girerek vardiyayı başlatın."
      maxWidth="md"
    >
      <form onSubmit={handleStartShift} className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Başlangıç Kasa Nakiti (₺)
          </label>
          <Input
            type="number"
            min="0"
            step="10"
            value={openingLira}
            onChange={(e) => setOpeningLira(e.target.value)}
            className="text-lg font-bold tabular-nums"
            required
            autoFocus
          />

          <div className="grid grid-cols-4 gap-2 pt-2">
            {[0, 1000, 1500, 2500].map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handlePreset(preset)}
                className="tabular-nums"
              >
                {preset.toLocaleString('tr-TR')} ₺
              </Button>
            ))}
          </div>
        </div>

        {shiftError ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)] break-words">{shiftError}</p>
        ) : null}

        <Button
          type="submit"
          variant="success"
          size="lg"
          className="w-full mt-2"
          isLoading={isSubmitting}
        >
          Vardiyayı Başlat
        </Button>
      </form>
    </Modal>
  );
};
