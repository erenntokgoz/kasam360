/**
 * Faz 13 · Seçili kroki öğesinin düzenleme şeridi.
 *
 * Neden ayrı bileşen: şerit masaya ve objeye farklı denetimler sunar
 * (döndür/sandalye ve sil). Ana çizim yüzeyinde iki koşul render etmek,
 * ölçüm zincirini üç katına çıkarır.
 */

import { OBJECT_KIND_LABELS, type FloorObject, type LayoutTable } from './krokiTypes';

const SANDALYE_KATALOGU = [2, 4, 6, 8];

export interface SelectionBarProps {
  table: LayoutTable | undefined;
  object: FloorObject | undefined;
  canEdit: boolean;
  onRotate: (id: string, rotation: number) => void;
  onSeats: (id: string, seats: number) => void;
  onDeleteObject: (id: string) => void;
}

const BUTON_TEMEL =
  'rounded-full border border-[var(--border)] px-3 py-1 tabular-nums transition-colors hover:bg-[var(--glass-thick)] active:scale-95 touch-manipulation';

export function SelectionBar({
  table,
  object,
  canEdit,
  onRotate,
  onSeats,
  onDeleteObject,
}: SelectionBarProps) {
  if (!canEdit || (!table && !object)) {
    return null;
  }

  if (table) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{table.name}</span>
        <span className="opacity-60 tabular-nums">
          {table.x} · {table.y}
        </span>
        <button
          type="button"
          onClick={() => onRotate(table.id, table.rotation - 15)}
          className={BUTON_TEMEL}
        >
          Sola çevir
        </button>
        <button
          type="button"
          onClick={() => onRotate(table.id, table.rotation + 15)}
          className={BUTON_TEMEL}
        >
          Sağa çevir
        </button>
        {SANDALYE_KATALOGU.map((adet) => (
          <button
            key={adet}
            type="button"
            onClick={() => onSeats(table.id, adet)}
            aria-pressed={table.seats === adet}
            className={`${BUTON_TEMEL} ${
              table.seats === adet ? 'border-[var(--brand)] font-semibold' : ''
            }`}
          >
            {adet}
          </button>
        ))}
      </div>
    );
  }

  if (object) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{OBJECT_KIND_LABELS[object.kind]}</span>
        <span className="opacity-60 tabular-nums">
          {object.x} · {object.y}
        </span>
        <button
          type="button"
          onClick={() => onDeleteObject(object.id)}
          className="rounded-full border border-[var(--danger)] px-3 py-1 text-[var(--danger)] transition-colors hover:bg-[var(--glass-thick)] active:scale-95 touch-manipulation"
        >
          Obje sil
        </button>
      </div>
    );
  }

  return null;
}