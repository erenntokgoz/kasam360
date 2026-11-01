import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { minutesElapsed, formatTime } from '../../lib/date';
import { useKdsStore } from '../../stores/kdsStore';
import { GuestPickerModal } from './GuestPickerModal';
import { TableOutline } from './TableOutline';

export interface TableCardProps {
  table: FloorTable;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

const TILTS = [-0.7, 0.4, -0.3, 0.6, -0.5, 0.3];

/** Eğim masaya sabittir: fiş yenilenince yerinde oynamaz. */
function tiltOf(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  return `${TILTS[sum % TILTS.length]}deg`;
}

/** Boş masa çizimdir; açık adisyon ve rezervasyon masanın üstündeki fiştir. */
export const TableCard: React.FC<TableCardProps> = ({ table, onOpenTable, onInspectTable }) => {
  const [showGuestPicker, setShowGuestPicker] = useState(false);
  const readyCount = useKdsStore((state) =>
    state.tickets
      .filter((ticket) => ticket.tableName === table.tableNumber)
      .flatMap((ticket) => ticket.items)
      .filter((item) => item.status === 'READY').length,
  );

  const isBillAsked = table.status === 'BILL_REQUESTED';
  const hasOrder = table.status === 'OCCUPIED' || isBillAsked;
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
        <button type="button" onClick={handleClick} className="table-spot" aria-label={`${table.tableNumber}, ${table.capacity} kişilik, boş`}>
          <TableOutline seats={table.capacity} />
          <span className="table-spot-name">{table.tableNumber}</span>
          {table.reservedAt ? <span className="table-spot-note tabular-nums">{formatTime(table.reservedAt)} rezerve</span> : null}
        </button>
        {guestPicker}
      </>
    );
  }

  const tone = isBillAsked ? 'slip-orange' : isReserved ? 'slip-blue' : '';

  return (
    <>
      <button type="button" onClick={handleClick} className="check-card" style={{ '--tilt': tiltOf(table.id) } as React.CSSProperties}>
        <span className={`sheet check ${tone}`}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="hand text-2xl leading-7 truncate">{table.tableNumber}</span>
            <span className="text-sm font-semibold tabular-nums text-[var(--text-secondary)] shrink-0">
              {hasOrder ? `${minutesElapsed(table.openedAt)} dk` : formatTime(table.reservedAt)}
            </span>
          </span>
          {hasOrder ? (
            <>
              <span className="text-sm truncate text-[var(--text-secondary)]">
                {isBillAsked ? (
                  <span className="font-bold text-[var(--ink)]">Hesap istendi</span>
                ) : readyCount > 0 ? (
                  <span className="ready-mark">{readyCount} kalem hazır</span>
                ) : (
                  table.waiterName ?? ''
                )}
              </span>
              <span className="text-2xl font-bold leading-7 tabular-nums">{formatMoney(table.remainingCents ?? table.totalCents)}</span>
            </>
          ) : (
            <span className="text-base font-bold leading-5 truncate">{table.customerName ?? 'Rezervasyon'}</span>
          )}
        </span>
      </button>
      {guestPicker}
    </>
  );
};
