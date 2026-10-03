/**
 * Faz 13 · Kroki mimari objeleri: kapı, bar, duvar, kolon.
 *
 * Dört tür tek bir bileşende çizilir çünkü hepsi dikdörtgen + etiket ve dört
 * ayrı bileşen dört ayrı sürükleme kaydı, dört ayrı test ve dört ayrı yol
 * hatası demektir. Şekil türden türetilir: bir tür için özel geometri
 * gerekirse buraya eklenir, ayrı bileşene değil.
 */

import { memo } from 'react';
import { OBJECT_KIND_LABELS, type FloorObject, type ObjectKind } from './krokiTypes';

/** Türe göre dolgu rengi. Apple sistem renkleri; gradient yok. */
const FILL: Record<ObjectKind, string> = {
  WALL: 'rgba(142, 142, 147, 0.32)',
  BAR: 'rgba(191, 90, 242, 0.18)',
  DOOR: 'rgba(100, 210, 255, 0.20)',
  COLUMN: 'rgba(162, 162, 167, 0.34)',
};

const STROKE: Record<ObjectKind, string> = {
  WALL: 'rgba(142, 142, 147, 0.55)',
  BAR: 'rgba(191, 90, 242, 0.55)',
  DOOR: 'rgba(100, 210, 255, 0.60)',
  COLUMN: 'rgba(162, 162, 167, 0.60)',
};

/** Duvarlar ve kolonlar etiket taşımaz: etiket, çizimi okunmaz hale getirir. */
const ETIKET_GOSTERIR: Record<ObjectKind, boolean> = {
  WALL: false,
  COLUMN: false,
  BAR: true,
  DOOR: true,
};

export interface ArchitecturalObjectProps {
  object: FloorObject;
  selected: boolean;
  onSelect: (id: string) => void;
  draggable: boolean;
}

function ArchitecturalObjectBilesen({
  object,
  selected,
  onSelect,
  draggable,
}: ArchitecturalObjectProps) {
  const etiketli = ETIKET_GOSTERIR[object.kind] && object.label;

  return (
    <button
      type="button"
      onClick={() => onSelect(object.id)}
      aria-pressed={selected}
      aria-label={`${OBJECT_KIND_LABELS[object.kind]}${object.label ? `: ${object.label}` : ''}`}
      className={`absolute select-none touch-manipulation ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
      style={{
        left: object.x,
        top: object.y,
        width: object.width,
        height: object.height,
        transform: `translate(-50%, -50%) rotate(${object.rotation}deg)`,
        transformOrigin: 'center',
      }}
    >
      <span
        className="absolute inset-0 rounded-lg border backdrop-blur-md"
        style={{
          backgroundColor: FILL[object.kind],
          borderColor: selected ? 'var(--brand)' : STROKE[object.kind],
          borderWidth: selected ? 2 : 1,
          boxShadow: selected ? '0 0 0 3px rgba(10, 132, 255, 0.28)' : 'none',
        }}
      />
      {etiketli && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[11px] font-medium px-1 truncate max-w-full">
            {object.label}
          </span>
        </span>
      )}
    </button>
  );
}

export const ArchitecturalObject = memo(ArchitecturalObjectBilesen);