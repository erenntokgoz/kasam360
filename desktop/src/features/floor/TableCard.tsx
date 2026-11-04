import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { useKdsStore } from '../../stores/kdsStore';
import { GuestPickerModal } from './GuestPickerModal';
import { TableFace } from './TableFace';

export interface TableCardProps {
  table: FloorTable;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

export const TableCard: React.FC<TableCardProps> = ({ table, onOpenTable, onInspectTable }) => {
  const [showGuestPicker, setShowGuestPicker] = useState(false);
  const readyCount = useKdsStore((state) =>
    state.tickets
      .filter((ticket) => ticket.tableName === table.tableNumber)
      .flatMap((ticket) => ticket.items)
      .filter((item) => item.status === 'READY').length,
  );
  const hasOrder = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';

  const handleClick = () => {
    // Rezervasyon yalnız masa çekmecesinden kapatılır: müşteri geldi ya da iptal edildi.
    if (hasOrder || table.reservationId) onInspectTable(table);
    else setShowGuestPicker(true);
  };

  return (
    <div className="table-cell">
      <TableFace table={table} readyCount={readyCount} onClick={handleClick} />
      <GuestPickerModal table={showGuestPicker ? table : null} onClose={() => setShowGuestPicker(false)} onPick={onOpenTable} />
    </div>
  );
};
