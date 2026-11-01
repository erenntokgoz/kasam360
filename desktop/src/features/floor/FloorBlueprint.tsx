import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { GuestPickerModal } from './GuestPickerModal';

export interface FloorBlueprintProps {
  tables: FloorTable[];
  isEditMode: boolean;
  onTablePositionChange: (tableId: string, posX: number, posY: number) => void;
  onSaveLayout: () => void;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

export const FloorBlueprint: React.FC<FloorBlueprintProps> = ({
  tables,
  isEditMode,
  onTablePositionChange,
  onSaveLayout,
  onOpenTable,
  onInspectTable,
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pickerTable, setPickerTable] = useState<FloorTable | null>(null);

  const handleMouseDown = (table: FloorTable, e: React.MouseEvent) => {
    if (!isEditMode) return;
    setDraggingId(table.id);
    setDragOffset({
      x: e.clientX - table.posX,
      y: e.clientY - table.posY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isEditMode || !draggingId) return;
    const newX = Math.max(10, Math.round((e.clientX - dragOffset.x) / 10) * 10);
    const newY = Math.max(10, Math.round((e.clientY - dragOffset.y) / 10) * 10);
    onTablePositionChange(draggingId, newX, newY);
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3 select-none">
      {isEditMode ? (
        <div className="paper px-4 py-2 flex items-center justify-between gap-3 shrink-0">
          <span className="font-semibold">Masaları sürükleyerek yerleştirin.</span>
          <Button variant="success" size="sm" onClick={onSaveLayout}>
            Yerleşimi Kaydet
          </Button>
        </div>
      ) : null}

      <div
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="flex-1 relative overflow-auto rounded-md"
        // Izgara yalnız düzenlerken görünür: serviste salon sade kalır.
        style={
          isEditMode
            ? {
                backgroundImage:
                  'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
                backgroundSize: '36px 36px',
              }
            : undefined
        }
      >
        <div className="min-w-[900px] min-h-[600px] relative w-full h-full">
          {tables.map((table) => {
            const hasOrder = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';
            const isReserved = table.status === 'RESERVED';
            const sheet = table.status === 'BILL_REQUESTED'
              ? 'bg-[var(--sheet-pink)] text-[var(--ink)]'
              : hasOrder
                ? 'bg-[var(--sheet-yellow)] text-[var(--ink)]'
                : isReserved
                  ? 'bg-[var(--sheet)] text-[var(--ink)]'
                  : 'border-2 border-dashed border-[var(--border-strong)]';

            return (
              <div
                key={table.id}
                onMouseDown={(e) => handleMouseDown(table, e)}
                onClick={() => {
                  if (isEditMode) return;
                  if (hasOrder || (isReserved && table.reservationId)) {
                    onInspectTable(table);
                  } else {
                    setPickerTable(table);
                  }
                }}
                style={{
                  left: `${table.posX}px`,
                  top: `${table.posY}px`,
                  width: `${table.width}px`,
                  height: `${table.height}px`,
                }}
                className={`absolute flex flex-col items-center justify-center p-2 text-center cursor-pointer select-none ${
                  table.shape === 'ROUND' ? 'rounded-full' : 'rounded-md'
                } ${sheet} ${isEditMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
              >
                <span className="font-extrabold leading-tight truncate max-w-full">{table.tableNumber}</span>
                {hasOrder ? (
                  <span className="hand text-xl leading-tight tabular-nums">{formatMoney(table.totalCents)}</span>
                ) : isReserved ? (
                  <span className="hand text-lg leading-tight truncate max-w-full">{table.customerName ?? 'Rezerve'}</span>
                ) : (
                  <span className="text-sm text-[var(--text-secondary)]">{table.capacity} kişilik</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <GuestPickerModal table={pickerTable} onClose={() => setPickerTable(null)} onPick={onOpenTable} />
    </div>
  );
};
