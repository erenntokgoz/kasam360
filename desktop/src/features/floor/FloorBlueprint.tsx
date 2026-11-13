import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { FloorObject, FloorTable, FloorZone } from '../../types/floor';
import { TABLE_SIZE, buildKroki, type PlacedTable } from '../../lib/krokiLayout';
import { clampToCanvas, dragPosition, pointerToWorld, type Point } from '../../lib/krokiGeometry';
import { GuestPickerModal } from './GuestPickerModal';
import { TableFace } from './TableFace';
import { DEFAULT_SCALE, getBlueprintCanvasSize, rotateFloorObject } from './blueprintView';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.25;

export interface FloorBlueprintProps {
  zones: FloorZone[];
  tables: FloorTable[];
  objects?: FloorObject[];
  /** Verilirse yalnız bu kısım çizilir. */
  zoneId?: string | null;
  /** Verilirse dışında kalan masalar soluk çizilir; yerleri kaymaz. */
  showTable?: (table: FloorTable) => boolean;
  isEditMode: boolean;
  onTablePositionChange: (tableId: string, posX: number, posY: number) => void;
  onTableRotate?: (tableId: string, rotation: number) => void;
  onObjectPositionChange?: (objectId: string, posX: number, posY: number) => void;
  onObjectRotate?: (objectId: string, rotation: number) => void;
  onSelectObject?: (objectId: string) => void;
  selectedObjectId?: string | null;
  onOpenTable: (table: FloorTable, guestCount: number) => void;
  onInspectTable: (table: FloorTable) => void;
}

interface Drag {
  kind: 'table' | 'object';
  id: string;
  /** Oda içeriğinin sol-üst köşesi; dünya koordinatının başlangıcı. */
  origin: HTMLElement;
  /** İmlecin nesne köşesine göre tutulduğu nokta (dünya birimi). */
  grab: Point;
  start: Point;
  size: { width: number; height: number };
  rotation: number;
  moved: boolean;
  /** Sürüklenen öğe; kalkma efekti (data-lifted) bunun üstünde açılıp kapanır. */
  node: HTMLElement;
}

export const FloorBlueprint: React.FC<FloorBlueprintProps> = ({ zones, tables, objects = [], zoneId, showTable, isEditMode, onTablePositionChange, onTableRotate, onObjectPositionChange, onObjectRotate, onSelectObject, selectedObjectId, onOpenTable, onInspectTable }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pickerTable, setPickerTable] = useState<FloorTable | null>(null);

  const visibleZones = useMemo(() => (zoneId ? zones.filter((zone) => zone.id === zoneId) : zones), [zones, zoneId]);
  const visibleObjects = useMemo(() => objects.filter((object) => object.isActive && (!zoneId || object.zoneId === zoneId)), [objects, zoneId]);
  const kroki = useMemo(() => buildKroki(visibleZones, tables, visibleObjects), [visibleZones, tables, visibleObjects]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setFrame({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setZoom(null), [zoneId]);

  const scale = zoom ?? DEFAULT_SCALE;
  const canvas = getBlueprintCanvasSize(kroki.width, kroki.height, frame.width, frame.height, scale);
  const visibleTableCount = kroki.rooms.reduce((count, room) => count + room.tables.filter(({ table }) => !showTable || showTable(table)).length, 0);
  const changeZoom = (factor: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * factor)));

  const startDrag = (kind: Drag['kind'], id: string, x: number, y: number, size: Drag['size'], rotation: number, event: React.PointerEvent) => {
    if (!isEditMode) return;
    const origin = event.currentTarget.closest<HTMLElement>('[data-kroki-origin]');
    if (!origin) return;
    suppressClickRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = origin.getBoundingClientRect();
    const pointer = pointerToWorld({ x: event.clientX, y: event.clientY }, { x: rect.left, y: rect.top }, scale);
    dragRef.current = { kind, id, origin, grab: { x: pointer.x - x, y: pointer.y - y }, start: { x: event.clientX, y: event.clientY }, size, rotation, moved: false, node: event.currentTarget as HTMLElement };
  };

  const moveDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 5) return;
    if (!drag.moved) drag.node.dataset.lifted = 'true';
    drag.moved = true;
    // Konum her harekette imlecin güncel dünya noktasından hesaplanır: zoom, kaydırma veya yeniden boyutlandırma
    // sürükleme ortasında olsa da birikmiş sapma oluşmaz.
    const rect = drag.origin.getBoundingClientRect();
    const pointer = pointerToWorld({ x: event.clientX, y: event.clientY }, { x: rect.left, y: rect.top }, scale);
    const { x, y } = dragPosition(pointer, drag.grab, drag.size, drag.rotation);
    if (drag.kind === 'table') onTablePositionChange(drag.id, x, y);
    else onObjectPositionChange?.(drag.id, x, y);
  };

  const endDrag = () => {
    // Sürükleme sonrası gelen click döndürme sayılmaz; yalnız sürüklemesiz dokunuş döndürür.
    if (dragRef.current?.moved) suppressClickRef.current = dragRef.current.id;
    if (dragRef.current) delete dragRef.current.node.dataset.lifted;
    dragRef.current = null;
  };

  const cancelDrag = () => {
    if (dragRef.current) delete dragRef.current.node.dataset.lifted;
    dragRef.current = null;
  };

  const rotateObject = (object: FloorObject) => {
    onSelectObject?.(object.id);
    onObjectRotate?.(object.id, rotateFloorObject(object.rotation));
  };

  const renderTable = ({ table, x, y }: PlacedTable) => {
    if (showTable && !showTable(table)) return null;
    const hasOrder = table.status === 'OCCUPIED';
    const handleClick = () => {
      if (isEditMode) {
        if (suppressClickRef.current === table.id) suppressClickRef.current = null;
        else onTableRotate?.(table.id, rotateFloorObject(table.rotation ?? 0));
        return;
      }
      if (hasOrder || table.reservationId) onInspectTable(table);
      else setPickerTable(table);
    };

    return (
      <TableFace
        key={table.id}
        table={table}
        onPointerDown={(event) => startDrag('table', table.id, x, y, { width: TABLE_SIZE, height: TABLE_SIZE }, table.rotation ?? 0, event)}
        onClick={handleClick}
        style={{ left: x, top: y, width: TABLE_SIZE, height: TABLE_SIZE, transform: `rotate(${table.rotation ?? 0}deg)`, '--rot': table.rotation ?? 0, touchAction: isEditMode ? 'none' : undefined } as React.CSSProperties}
        className={`!absolute ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      />
    );
  };

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden select-none flex flex-col">
      <div className="kroki-zoom shrink-0">
        {isEditMode ? <span className="mr-auto text-xs text-[var(--text-secondary)]">Sürükleyerek taşıyın, dokunarak 45 derece döndürün</span> : null}
        <button type="button" aria-label="Uzaklaştır" onClick={() => changeZoom(1 / ZOOM_STEP)}>
          <Minus className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Gerçek boyut" onClick={() => setZoom(null)}>
          <Maximize className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Yakınlaştır" onClick={() => changeZoom(ZOOM_STEP)}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <div ref={frameRef} className="kroki-mat flex-1 min-h-0" data-edit={isEditMode} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}>
        <div className="relative shrink-0" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}>
            {kroki.rooms.map((room) => (
              <section key={room.id} className="kroki-room" style={{ left: room.left, top: room.top, width: visibleZones.length === 1 ? canvas.width : room.width, height: visibleZones.length === 1 ? canvas.height : room.height }}>
                <header className="kroki-room-head">
                  <h3>{room.name}</h3>
                  <span className="tabular-nums">{room.tables.filter(({ table }) => !showTable || showTable(table)).length}</span>
                </header>
                <div className="relative" data-kroki-origin>
                  {room.tables.map(renderTable)}
                  {visibleObjects.filter((object) => object.zoneId === room.id).map((object) => (
                    <div
                      key={object.id}
                      role={isEditMode ? 'button' : 'img'}
                      tabIndex={isEditMode ? 0 : undefined}
                      aria-label={`${object.kind === 'WINDOW' ? 'Pencere' : 'Kapı'}: ${object.label ?? 'Etiketsiz'}. Düzenleme modunda dokunarak veya Enter/Boşluk ile saat yönünde 45 derece döndürür.`}
                      title={object.label ?? undefined}
                      onPointerDown={(event) => startDrag('object', object.id, object.x, object.y, { width: object.width, height: object.height }, object.rotation, event)}
                      onClick={() => {
                        if (suppressClickRef.current === object.id) {
                          suppressClickRef.current = null;
                          return;
                        }
                        if (isEditMode) rotateObject(object);
                        else onSelectObject?.(object.id);
                      }}
                      onKeyDown={(event) => {
                        if (isEditMode && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          rotateObject(object);
                        }
                        if (event.key.startsWith('Arrow')) {
                          event.preventDefault();
                          const step = event.shiftKey ? 50 : 10;
                          const next = clampToCanvas({ x: object.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: object.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }, object, object.rotation);
                          onObjectPositionChange?.(object.id, Math.round(next.x), Math.round(next.y));
                        }
                      }}
                      className={`kroki-object ${object.kind === 'WINDOW' ? 'kroki-object-window' : 'kroki-object-door'} ${selectedObjectId === object.id ? 'is-selected' : ''} ${isEditMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{ left: object.x, top: object.y, width: object.width, height: object.height, transform: `rotate(${object.rotation}deg)`, transformOrigin: 'center', touchAction: 'none' }}
                    >
                      <span style={{ transform: `rotate(${-object.rotation}deg)` }}>{object.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      {showTable && visibleTableCount === 0 ? <div role="status" className="absolute inset-0 z-10 flex items-center justify-center text-[var(--text-secondary)] pointer-events-none">Bu durumda masa yok.</div> : null}
      <GuestPickerModal table={pickerTable} onClose={() => setPickerTable(null)} onPick={onOpenTable} />
    </div>
  );
};
