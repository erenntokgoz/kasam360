/**
 * Faz 13 · Krokideki masa şekli.
 *
 * Isı haritası buradan türer: masa doluluğu ayrı bir alan değil, `status`
 * alanının görsel karşılığıdır. Renk üç ayrı bileşende ayrı ayrı seçilirse
 * salon bir yerde boş görünür ve patron yanlış karar verir.
 *
 * AGENTS.md §3.2: gradient yasak. Masa dolgusu düz `rgba` katmanıdır; renk
 * geçişi değil, cam üstünde tek katman.
 */

import { memo } from 'react';
import { TABLE_STATUS_STYLE, type LayoutTable, type TableStatus } from './krokiTypes';

export const TABLE_WIDTH = 120;
export const TABLE_HEIGHT = 80;

/** Sandalye sayısına göre sandalye noktalarının kenar ofseti. */
const CHAIR_OFFSETS: Record<number, [number, number][]> = {
  2: [
    [-18, 0],
    [18, 0],
  ],
  4: [
    [-18, 0],
    [18, 0],
    [0, -18],
    [0, 18],
  ],
  6: [
    [-18, 0],
    [18, 0],
    [0, -18],
    [0, 18],
    [-18, -18],
    [18, 18],
  ],
  8: [
    [-18, 0],
    [18, 0],
    [0, -18],
    [0, 18],
    [-18, -18],
    [18, 18],
    [-18, 18],
    [18, -18],
  ],
};

/** Duruma göre cam yüzey rengi. Apple sistem renkleri (dark + light). */
const SURFACE: Record<TableStatus, string> = {
  AVAILABLE: 'rgba(48, 209, 88, 0.16)',
  RESERVED: 'rgba(255, 159, 10, 0.16)',
  OCCUPIED: 'rgba(255, 69, 58, 0.16)',
};

const STROKE: Record<TableStatus, string> = {
  AVAILABLE: 'rgba(48, 209, 88, 0.55)',
  RESERVED: 'rgba(255, 159, 10, 0.55)',
  OCCUPIED: 'rgba(255, 69, 58, 0.55)',
};

export interface TableShapeProps {
  table: LayoutTable;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Çizim yetkisi yoksa sürükleme açılmaz; kroki salt görüntülenir. */
  draggable: boolean;
}

/**
 * Masa şekli.
 *
 * Neden `memo`: krokide 40 masa varken her fare hareketi tüm listeyi yeniden
 * çizer. React 18'de bu gözle görülür bir gecikmedir ve sürükleme "yapışkan"
 * hissettirir. Sadece değişen masa yeniden çizilmelidir.
 */
function TableShapeBilesen({ table, selected, onSelect, draggable }: TableShapeProps) {
  const stil = TABLE_STATUS_STYLE[table.status];
  const sandalyeler = CHAIR_OFFSETS[table.seats] ?? CHAIR_OFFSETS[4];

  return (
    <button
      type="button"
      onClick={() => onSelect(table.id)}
      aria-pressed={selected}
      aria-label={`${table.name}, ${stil.label}, ${table.seats} sandalye`}
      className={`absolute flex items-center justify-center select-none touch-manipulation ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
      style={{
        left: table.x,
        top: table.y,
        width: TABLE_WIDTH,
        height: TABLE_HEIGHT,
        transform: `translate(-50%, -50%) rotate(${table.rotation}deg)`,
        transformOrigin: 'center',
      }}
    >
      {sandalyeler.map(([dx, dy], sira) => (
        <span
          key={sira}
          aria-hidden="true"
          className="absolute rounded-full border"
          style={{
            width: 14,
            height: 14,
            left: TABLE_WIDTH / 2 + dx - 7,
            top: TABLE_HEIGHT / 2 + dy - 7,
            backgroundColor: 'var(--glass-thick)',
            borderColor: STROKE[table.status],
          }}
        />
      ))}
      <span
        className="absolute inset-0 rounded-2xl border backdrop-blur-xl"
        style={{
          backgroundColor: SURFACE[table.status],
          borderColor: selected ? 'var(--brand)' : STROKE[table.status],
          borderWidth: selected ? 2 : 1,
          boxShadow: selected
            ? '0 0 0 3px rgba(10, 132, 255, 0.28)'
            : 'inset 0 1px 0 0 rgba(255, 255, 255, 0.10)',
        }}
      />
      <span className="relative z-10 flex flex-col items-center pointer-events-none px-1">
        <span className="text-xs font-semibold tabular-nums truncate max-w-full">
          {table.name}
        </span>
        <span className="text-[11px] opacity-60 tabular-nums">
          {stil.label} · {table.seats} sandalye
        </span>
      </span>
    </button>
  );
}

export const TableShape = memo(TableShapeBilesen);