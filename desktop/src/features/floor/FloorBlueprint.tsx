import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { FloorTable, FloorZone } from '../../types/floor';
import { TABLE_SIZE, buildKroki, type PlacedTable } from '../../lib/krokiLayout';
import { GuestPickerModal } from './GuestPickerModal';
import { TableFace } from './TableFace';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.25;
const SNAP = 10;
const MAX_FIT = 1.6;
const FRAME_GAP = 24;

export interface FloorBlueprintProps {
  zones: FloorZone[];
  tables: FloorTable[];
  /** Verilirse yalnız bu kısım çizilir. */
  zoneId?: string | null;
  /** Verilirse dışında kalan masalar soluk çizilir; yerleri kaymaz. */
  matches?: (table: FloorTable) => boolean;
  isEditMode: boolean;
  onTablePositionChange: (tableId: string, posX: number, posY: number) => void;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

interface Drag {
  id: string;
  pointerX: number;
  pointerY: number;
  tableX: number;
  tableY: number;
}

export const FloorBlueprint: React.FC<FloorBlueprintProps> = ({ zones, tables, zoneId, matches, isEditMode, onTablePositionChange, onOpenTable, onInspectTable }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pickerTable, setPickerTable] = useState<FloorTable | null>(null);

  const visibleZones = useMemo(() => (zoneId ? zones.filter((zone) => zone.id === zoneId) : zones), [zones, zoneId]);
  const kroki = useMemo(() => buildKroki(visibleZones, tables), [visibleZones, tables]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setFrame({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setZoom(null), [zoneId]);

  const fit = kroki.width && frame.width ? Math.min(MAX_FIT, (frame.width - FRAME_GAP) / kroki.width, (frame.height - FRAME_GAP) / kroki.height) : 1;
  const scale = zoom ?? Math.max(MIN_ZOOM, fit);
  const changeZoom = (factor: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor)));

  const startDrag = (item: PlacedTable, event: React.PointerEvent) => {
    if (!isEditMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: item.table.id, pointerX: event.clientX, pointerY: event.clientY, tableX: item.x, tableY: item.y };
  };

  const moveDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Ölçek sürüklerken değişir: toplam yol değil, son harekete göre ilerlenir.
    drag.tableX += (event.clientX - drag.pointerX) / scale;
    drag.tableY += (event.clientY - drag.pointerY) / scale;
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    const snap = (value: number) => Math.round(value / SNAP) * SNAP;
    const x = snap(drag.tableX);
    const y = snap(drag.tableY);
    // (0,0) yerleştirilmemiş demektir; bu kareye bırakılan masa dizilime geri dönmesin.
    onTablePositionChange(drag.id, x === 0 && y === 0 ? SNAP : x, y);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const renderTable = ({ table, x, y }: PlacedTable) => {
    const hasOrder = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';
    const handleClick = () => {
      if (isEditMode) return;
      if (hasOrder || table.reservationId) onInspectTable(table);
      else setPickerTable(table);
    };

    return (
      <TableFace
        key={table.id}
        table={table}
        onPointerDown={(event) => startDrag({ table, x, y }, event)}
        onClick={handleClick}
        style={{ left: x, top: y, width: TABLE_SIZE, height: TABLE_SIZE, touchAction: isEditMode ? 'none' : undefined }}
        className={`!absolute ${matches && !matches(table) ? 'opacity-25' : ''} ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      />
    );
  };

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden select-none">
      <div ref={frameRef} className="kroki-mat" data-edit={isEditMode} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="relative shrink-0 m-auto" style={{ width: kroki.width * scale, height: kroki.height * scale }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: kroki.width, height: kroki.height, transform: `scale(${scale})` }}>
            {kroki.rooms.map((room) => (
              <section key={room.id} className="kroki-room" style={{ left: room.left, top: room.top, width: room.width, height: room.height }}>
                <header className="kroki-room-head">
                  <h3>{room.name}</h3>
                  <span className="tabular-nums">{room.tables.length}</span>
                </header>
                <div className="relative" style={{ left: room.offsetX, top: room.offsetY }}>
                  {room.tables.map(renderTable)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      <div className="kroki-zoom">
        <button type="button" aria-label="Uzaklaştır" onClick={() => changeZoom(1 / ZOOM_STEP)}>
          <Minus className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Ekrana sığdır" onClick={() => setZoom(null)}>
          <Maximize className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Yakınlaştır" onClick={() => changeZoom(ZOOM_STEP)}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <GuestPickerModal table={pickerTable} onClose={() => setPickerTable(null)} onPick={onOpenTable} />
    </div>
  );
};
