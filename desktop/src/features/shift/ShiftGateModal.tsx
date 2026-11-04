import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { NumberInput } from '../../ui/NumberInput';
import { useShiftStore } from '../../stores/shiftStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Numpad } from '../../ui/Numpad';

export const ShiftGateModal: React.FC = () => {
  const { user } = useAuthStore();
  const { openShift, activeShift, shiftError } = useShiftStore();
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);

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
      setInputError(errorText(error));
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
      maxWidth="md"
    >
      <form onSubmit={handleStartShift} className="space-y-4">
        <div>
          <label htmlFor="opening-cash" className="block text-sm font-semibold mb-1 text-[var(--text-secondary)]">
            Çekmecedeki Nakit (₺)
          </label>
          <NumberInput
            id="opening-cash"
            pinpad={false}
            value={openingLira}
            onValueChange={setOpeningLira}
            className="!min-h-14 text-xl font-bold tabular-nums"
            required
          />
        </div>

        <Numpad
          buttonHeightClass="!min-h-14"
          onDigit={(digit) => {
            if (openingLira.length < 7) setOpeningLira(openingLira === '0' ? digit : openingLira + digit);
          }}
          onClear={() => setOpeningLira('0')}
          onBackspace={() => setOpeningLira(openingLira.slice(0, -1) || '0')}
        />

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
