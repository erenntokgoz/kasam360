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
  const [inputError, setInputError] = useState<string | null>(null);

  const isOpen = modals.shiftGate || (!activeShift?.isOpen && modals.payment);

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    let cents: number;
    try {
      cents = parseMoneyToCents(openingLira);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
      return;
    }
    setInputError(null);
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
      onClose={() => {
        closeModal('shiftGate');
        closeModal('payment');
      }}
      title="Vardiya Açılışı"
      subtitle="Satış almak için çekmecedeki nakdi sayıp girin."
      maxWidth="md"
    >
      <form onSubmit={handleStartShift} className="space-y-4">
        <div>
          <label htmlFor="opening-cash" className="block text-sm font-semibold mb-1 text-[var(--text-secondary)]">
            Çekmecedeki Nakit (₺)
          </label>
          <Input
            id="opening-cash"
            inputMode="decimal"
            value={openingLira}
            onChange={(e) => setOpeningLira(e.target.value)}
            className="!min-h-14 text-xl font-bold tabular-nums"
            required
          />
        </div>

        {inputError ? (
          <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{inputError}</p>
        ) : null}
        {shiftError ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)] break-words">{shiftError}</p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          isLoading={isSubmitting}
        >
          Vardiyayı Aç
        </Button>
      </form>
    </Modal>
  );
};
