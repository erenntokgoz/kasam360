import React, { useState } from 'react';
import { Users, Clock, X } from 'lucide-react';
import type { FloorTable } from '../../types/floor';
import { formatMoney } from '../../lib/formatMoney';
import { minutesElapsed, formatTime } from '../../lib/date';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export interface TableCardProps {
  table: FloorTable;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

export const TableCard: React.FC<TableCardProps> = ({ table, onOpenTable, onInspectTable }) => {
  const [showGuestPicker, setShowGuestPicker] = useState(false);

  const isOccupied = table.status === 'OCCUPIED';
  const isReserved = table.status === 'RESERVED';
  const isEmpty = table.status === 'EMPTY';

  const elapsedMins = isOccupied ? minutesElapsed(table.openedAt) : 0;

  const handleClick = () => {
    if (isOccupied) {
      onInspectTable(table);
    } else if (isEmpty) {
      setShowGuestPicker(true);
    } else if (isReserved) {
      // Rezerve masaya tıklandığında yine de teyit ile sipariş açılabilir
      setShowGuestPicker(true);
    }
  };

  const handleSelectGuests = (count: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowGuestPicker(false);
    onOpenTable(table, count);
  };

  return (
    <div
      onClick={handleClick}
      className={`relative min-h-[120px] rounded-xl border p-3 flex flex-col justify-between cursor-pointer select-none transition-all duration-100 ${
        isOccupied
          ? 'bg-[var(--bg-card)] border-[var(--accent-amber-border)] shadow-md hover:border-[var(--accent-amber)]'
          : isReserved
          ? 'bg-[var(--bg-card)] border-[var(--accent-blue-border)] shadow-sm hover:border-[var(--accent-blue)]'
          : 'bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--accent-emerald-border)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* Üst Satır: Masa Adı ve Durum Rozeti */}
      <div className="flex items-start justify-between gap-1.5">
        <div>
          <span className="text-sm font-bold text-[var(--text-primary)] block tracking-tight">
            {table.tableNumber}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
            <Users className="w-3 h-3" />
            <span>{table.capacity} Kişilik</span>
          </span>
        </div>

        <div>
          {isOccupied ? (
            <Badge variant="amber">Dolu</Badge>
          ) : isReserved ? (
            <Badge variant="blue">Rezerve</Badge>
          ) : (
            <Badge variant="emerald">Boş</Badge>
          )}
        </div>
      </div>

      {/* Orta / Alt Bölüm: Bakiye veya Bilgi */}
      <div className="mt-2 pt-2 border-t border-[var(--border)]">
        {isOccupied ? (
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1 tabular-nums">
              <Clock className="w-3 h-3 text-[var(--accent-amber)]" />
              <span>{elapsedMins} dk</span>
            </span>
            <span className="text-sm font-bold text-[var(--accent-amber)] tabular-nums">
              {formatMoney(table.totalCents)}
            </span>
          </div>
        ) : isReserved ? (
          <div className="text-[11px] text-[var(--accent-blue)] truncate">
            <span>{table.customerName || 'Rezervasyon'}</span>
            <span className="block text-[10px] text-[var(--text-muted)]">
              Saat: {formatTime(table.reservedAt)}
            </span>
          </div>
        ) : (
          <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
            <span>Müsait</span>
            <span className="text-[10px] text-[var(--accent-emerald)] font-semibold">+ Sipariş Aç</span>
          </div>
        )}
      </div>

      {/* Hızlı Kişi Sayısı Seçici Popover */}
      {showGuestPicker ? (
        <div
          className="absolute inset-0 z-20 bg-[var(--bg-panel)] rounded-xl border border-[var(--accent-amber-border)] p-2.5 flex flex-col justify-between shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-1 border-b border-[var(--border)]">
            <span className="text-[11px] font-bold text-[var(--text-primary)]">
              {table.tableNumber} · Kişi Sayısı
            </span>
            <button
              type="button"
              onClick={() => setShowGuestPicker(false)}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              aria-label="Kapat"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5 py-1">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
              <Button
                key={num}
                type="button"
                variant="secondary"
                size="sm"
                onClick={(e) => handleSelectGuests(num, e)}
                className="!min-h-[34px] text-xs font-bold tabular-nums"
              >
                {num}
              </Button>
            ))}
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={(e) => handleSelectGuests(2, e)}
            className="!min-h-[32px] text-xs w-full"
          >
            Siparişe Başla (2 Kişi)
          </Button>
        </div>
      ) : null}
    </div>
  );
};
