import React from 'react';
import type { FloorTable } from '../../types/floor';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

const GUEST_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

export interface GuestPickerModalProps {
  table: FloorTable | null;
  onClose: () => void;
  onPick: (table: FloorTable, guestCount: number) => void;
}

/** Masa kartı ve salon planı aynı seçiciyi kullanır: masa açmanın tek yolu vardır. */
export const GuestPickerModal: React.FC<GuestPickerModalProps> = ({ table, onClose, onPick }) => (
  <Modal isOpen={table !== null} onClose={onClose} title={table?.tableNumber ?? ''} subtitle="Kaç kişi oturuyor?" maxWidth="sm">
    <div className="grid grid-cols-4 gap-2">
      {GUEST_COUNTS.map((count) => (
        <Button
          key={count}
          variant="secondary"
          size="lg"
          className="!min-h-16 text-xl tabular-nums"
          onClick={() => {
            if (!table) return;
            onClose();
            onPick(table, count);
          }}
        >
          {count}
        </Button>
      ))}
    </div>
  </Modal>
);
