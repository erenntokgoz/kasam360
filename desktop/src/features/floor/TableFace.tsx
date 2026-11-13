import React from 'react';
import { formatTime, minutesElapsed } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import type { FloorTable } from '../../types/floor';
import { TableOutline } from './TableOutline';

export interface TableFaceProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  table: FloorTable;
  readyCount?: number;
}

/** Masa bu sürede en koyu tonuna ulaşır. */
const AGE_FULL_MINUTES = 120;

const stateOf = (table: FloorTable) => {
  if (table.status === 'OCCUPIED') return 'busy';
  if (table.status === 'RESERVED') return 'reserved';
  return 'empty';
};

/** Masa her durumda aynı çizimdir: sandalyeler kapasiteyi, renk ve iç yazı durumu söyler. */
export const TableFace: React.FC<TableFaceProps> = ({ table, readyCount = 0, className = '', style, ...button }) => {
  const state = stateOf(table);
  const hasOrder = state === 'busy';
  const elapsed = minutesElapsed(table.openedAt);
  const amount = formatMoney(table.remainingCents ?? table.totalCents);
  const waiter = table.waiterName?.trim();
  const orderDetail = readyCount > 0 ? `${readyCount} hazır` : `${elapsed} dk`;
  const accessibleDetails = hasOrder
    ? [amount, waiter, orderDetail].filter(Boolean).join(', ')
    : state === 'reserved'
      ? [formatTime(table.reservedAt), table.customerName ?? 'Rezerve'].join(', ')
      : '';

  return (
    <button type="button" className={`table-spot ${className}`} data-state={state} data-table-id={table.id} style={{ ...style, '--age': hasOrder ? Math.min(elapsed / AGE_FULL_MINUTES, 1) : 0 } as React.CSSProperties} aria-label={[`${table.tableNumber}, ${table.capacity} kişilik`, accessibleDetails].filter(Boolean).join(', ')} {...button}>
      <TableOutline seats={table.capacity} />
      <span className="table-spot-name truncate max-w-[66%]">{table.tableNumber}</span>
      {hasOrder ? (
        <>
          <span className="table-spot-amount tabular-nums">{amount}</span>
          {/* Dört satır masa çiziminin dışına taşıyordu: garson ve süre tek satırdadır. */}
          <span className="table-spot-note tabular-nums truncate max-w-[80%]">
            {[
              waiter,
              orderDetail,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </>
      ) : null}
      {state === 'reserved' ? (
        <>
          <span className="table-spot-note tabular-nums">{formatTime(table.reservedAt)}</span>
          <span className="table-spot-note truncate max-w-[66%]">{table.customerName ?? 'Rezerve'}</span>
        </>
      ) : null}
    </button>
  );
};
