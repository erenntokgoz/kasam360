import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { TableOutline } from './TableOutline';
import { GuestPickerModal } from './GuestPickerModal';

export interface FloorBlueprintProps {
  tables: FloorTable[];
  isEditMode: boolean;
  onTablePositionChange: (tableId: string, posX: number, posY: number) => void;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

export const FloorBlueprint: React.FC<FloorBlueprintProps> = ({
  tables,
  isEditMode,
  onTablePositionChange,
  onOpenTable,
  onInspectTable,
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pickerTable, setPickerTable] = useState<FloorTable | null>(null);

  const handlePointerDown = (table: FloorTable, e: React.PointerEvent) => {
    if (!isEditMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(table.id);
    setDragOffset({
      x: e.clientX - table.posX,
      y: e.clientY - table.posY,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isEditMode || !draggingId) return;
    const newX = Math.max(10, Math.round((e.clientX - dragOffset.x) / 10) * 10);
    const newY = Math.max(10, Math.round((e.clientY - dragOffset.y) / 10) * 10);
    onTablePositionChange(draggingId, newX, newY);
  };

  const handlePointerUp = () => {
    setDraggingId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-2 select-none">
      {isEditMode ? <p className="zone-title shrink-0">Masaları sürükleyin, bitince Bitir'e basın.</p> : null}

      <div onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className="flex-1 relative overflow-auto">
        <div className="min-w-[900px] min-h-[600px] relative w-full h-full">
          {tables.map((table) => {
            const isBillAsked = table.status === 'BILL_REQUESTED';
            const hasOrder = table.status === 'OCCUPIED' || isBillAsked;
            const isReserved = table.status === 'RESERVED';
            const place = {
              left: `${table.posX}px`,
              top: `${table.posY}px`,
              width: `${table.width}px`,
              height: `${table.height}px`,
              touchAction: isEditMode ? 'none' : undefined,
            } as const;
            const handleClick = () => {
              if (isEditMode) return;
              if (hasOrder || (isReserved && table.reservationId)) onInspectTable(table);
              else setPickerTable(table);
            };
            const dragClass = isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer';

            if (!hasOrder && !isReserved) {
              return (
                <button
                  key={table.id}
                  type="button"
                  onPointerDown={(e) => handlePointerDown(table, e)}
                  onClick={handleClick}
                  style={place}
                  className={`table-spot !absolute ${dragClass}`}
                >
                  <TableOutline seats={table.capacity} />
                  <span className="table-spot-name !text-base truncate max-w-[70%]">{table.tableNumber}</span>
                </button>
              );
            }

            return (
              <button
                key={table.id}
                type="button"
                onPointerDown={(e) => handlePointerDown(table, e)}
                onClick={handleClick}
                style={place}
                className={`sheet ${isBillAsked ? 'slip-orange' : isReserved ? 'slip-blue' : ''} absolute flex flex-col items-center justify-center p-2 text-center ${dragClass}`}
              >
                <span className="hand text-base leading-tight truncate max-w-full">{table.tableNumber}</span>
                {hasOrder ? (
                  <span className="text-sm font-bold leading-tight tabular-nums">{formatMoney(table.remainingCents ?? table.totalCents)}</span>
                ) : (
                  <span className="text-sm leading-tight truncate max-w-full">{table.customerName ?? 'Rezerve'}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <GuestPickerModal table={pickerTable} onClose={() => setPickerTable(null)} onPick={onOpenTable} />
    </div>
  );
};
