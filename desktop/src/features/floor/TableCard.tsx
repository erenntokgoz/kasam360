import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { minutesElapsed, formatTime } from '../../lib/date';
import { GuestPickerModal } from './GuestPickerModal';

export interface TableCardProps {
  table: FloorTable;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

/** Dolu masa gerçek bir adisyon yaprağıdır; boş masa yalnız yer tutar. */
export const TableCard: React.FC<TableCardProps> = ({ table, onOpenTable, onInspectTable }) => {
  const [showGuestPicker, setShowGuestPicker] = useState(false);

  const hasOrder = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';
  const isReserved = table.status === 'RESERVED';

  const handleClick = () => {
    // Rezervasyon yalnız masa çekmecesinden kapatılır: müşteri geldi ya da iptal edildi.
    if (hasOrder || (isReserved && table.reservationId)) onInspectTable(table);
    else setShowGuestPicker(true);
  };

  const guestPicker = (
    <GuestPickerModal table={showGuestPicker ? table : null} onClose={() => setShowGuestPicker(false)} onPick={onOpenTable} />
  );

  if (!hasOrder && !isReserved) {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          className="min-h-[150px] h-full p-4 rounded-md border-2 border-dashed border-[var(--border-strong)] flex flex-col justify-between text-left cursor-pointer hover:bg-[var(--bg-panel)] transition-colors"
        >
          <span className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] truncate w-full">
            {table.tableNumber}
          </span>
          <span className="text-sm text-[var(--text-secondary)]">Boş · {table.capacity} kişilik</span>
        </button>
        {guestPicker}
      </>
    );
  }

  const sheet = table.status === 'BILL_REQUESTED' ? 'slip-pink' : isReserved ? 'slip-white' : 'slip-yellow';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`slip ${sheet} min-h-[150px] h-full rounded-t-md px-4 pb-3 flex flex-col justify-between text-left cursor-pointer transition-transform duration-75 active:translate-y-[2px]`}
      >
        <span className="print-title text-3xl leading-none truncate w-full">{table.tableNumber}</span>
        {hasOrder ? (
          <span className="block">
            <span className="block text-sm font-bold">
              {table.status === 'BILL_REQUESTED' ? 'Hesap istendi' : `${table.waiterName ?? 'Servis'} · ${table.occupiedSeats ?? table.capacity} kişi`}
              {' · '}
              <span className="tabular-nums">{minutesElapsed(table.openedAt)} dk</span>
            </span>
            <span className="hand block text-3xl leading-tight tabular-nums">{formatMoney(table.totalCents)}</span>
          </span>
        ) : (
          <span className="block">
            <span className="block text-sm font-bold">Rezerve · {formatTime(table.reservedAt)}</span>
            <span className="hand block text-2xl leading-tight truncate">{table.customerName ?? 'Rezervasyon'}</span>
          </span>
        )}
      </button>
      {guestPicker}
    </>
  );
};
