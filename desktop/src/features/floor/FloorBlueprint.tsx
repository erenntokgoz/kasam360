import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { X } from 'lucide-react';

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

  const handleSelectGuests = (table: FloorTable, count: number) => {
    setPickerTable(null);
    onOpenTable(table, count);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3 select-none">
      {isEditMode ? (
        <div className="paper border border-[var(--accent-amber-border)] rounded-lg px-4 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
          <span className="text-xs font-semibold text-[var(--accent-amber)]">
            Düzenleme Modu Aktif: Masaları fare ile sürükleyerek salon yerleşimini güncelleyebilirsiniz.
          </span>
          <Button variant="success" size="sm" onClick={onSaveLayout}>
            Yerleşimi Kaydet
          </Button>
        </div>
      ) : null}

      <div
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="flex-1 rounded-xl border border-[var(--border)] relative overflow-auto bg-[var(--bg-subtle)]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      >
        <div className="min-w-[900px] min-h-[600px] relative w-full h-full">
          {tables.map((table) => {
            const isOccupied = table.status === 'OCCUPIED';
            const isReserved = table.status === 'RESERVED';

            return (
              <div
                key={table.id}
                onMouseDown={(e) => handleMouseDown(table, e)}
                onClick={() => {
                  if (isEditMode) return;
                  if (isOccupied) {
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
                className={`absolute flex flex-col items-center justify-center p-2 text-center transition-shadow cursor-pointer select-none ${
                  table.shape === 'ROUND' ? 'rounded-full' : 'rounded-xl'
                } border ${
                  isOccupied
                    ? 'bg-[var(--bg-card)] border-[var(--accent-amber)] shadow-md text-[var(--accent-amber)]'
                    : isReserved
                    ? 'bg-[var(--bg-card)] border-[var(--accent-blue)] text-[var(--accent-blue)]'
                    : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent-emerald)]'
                } ${isEditMode ? 'cursor-grab active:cursor-grabbing border-dashed' : ''}`}
              >
                <span className="text-xs font-bold leading-tight truncate px-1">
                  {table.tableNumber}
                </span>

                {isOccupied ? (
                  <span className="text-[10px] font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
                    {formatMoney(table.totalCents)}
                  </span>
                ) : isReserved ? (
                  <span className="text-[10px] text-[var(--accent-blue)] truncate px-1">
                    {table.customerName || 'Rezerve'}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {table.capacity}K
                  </span>
                )}
              </div>
            );
          })}

          {/* Hızlı Kişi Sayısı Seçici Popover (Kroki Üzeri) */}
          {pickerTable ? (
            <div
              className="absolute z-30 paper rounded-xl border border-[var(--accent-amber-border)] p-3 shadow-2xl flex flex-col gap-2 min-w-[200px]"
              style={{
                left: `${Math.min(pickerTable.posX + 10, 700)}px`,
                top: `${Math.min(pickerTable.posY + 10, 420)}px`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-1 border-b border-[var(--border)]">
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  {pickerTable.tableNumber} · Kişi Sayısı
                </span>
                <button
                  type="button"
                  onClick={() => setPickerTable(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 py-1">
                {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
                  <Button
                    key={num}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSelectGuests(pickerTable, num)}
                    className="!min-h-12 text-xs font-bold tabular-nums"
                  >
                    {num}
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => handleSelectGuests(pickerTable, 2)}
                className="!min-h-12 text-xs w-full"
              >
                Siparişe Başla (2 Kişi)
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
