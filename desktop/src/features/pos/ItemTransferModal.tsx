import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import type { OrderItem } from '../../types/pos';
import type { FloorTable } from '../../types/floor';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';

export interface ItemTransferModalProps {
  isOpen: boolean;
  item: OrderItem | null;
  tables: FloorTable[];
  currentTableId: string | null;
  onClose: () => void;
  onConfirmTransfer: (targetTableId: string, quantity: number) => void;
}

export const ItemTransferModal: React.FC<ItemTransferModalProps> = ({
  isOpen,
  item,
  tables,
  currentTableId,
  onClose,
  onConfirmTransfer,
}) => {
  const [targetTableId, setTargetTableId] = useState('');
  const [quantity, setQuantity] = useState(1);

  if (!item) return null;

  const validTargetTables = tables.filter((t) => t.id !== currentTableId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTableId) return;
    onConfirmTransfer(targetTableId, Math.min(item.quantity, Math.max(1, quantity)));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Kalemi Başka Masaya Taşı"
      subtitle={item.name}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Taşınacak Adet (Mevcut: {item.quantity})
          </label>
          <NumberInput kind="integer"
            value={quantity}
            onValueChange={(text) => setQuantity(Number.parseInt(text, 10) || 0)}
            className="text-center font-bold text-base"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Hedef Masa
          </label>
          <select
            value={targetTableId}
            onChange={(e) => setTargetTableId(e.target.value)}
            className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
            required
          >
            <option value="">Hedef masa seçin...</option>
            {validTargetTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tableNumber} ({t.zoneName} · {t.status === 'OCCUPIED' ? 'Dolu' : 'Boş'})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Vazgeç
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            disabled={!targetTableId}
          >
            Kalemi Taşı
          </Button>
        </div>
      </form>
    </Modal>
  );
};
