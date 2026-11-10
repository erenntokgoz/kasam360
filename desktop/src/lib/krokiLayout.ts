import type { FloorTable } from '../types/floor';
import { rotatedBounds } from './krokiGeometry';

export const TABLE_SIZE = 110;
const CELL = 140;
const PADDING = 30;
const HEADER = 56;
const ROOM_MIN_WIDTH = 480;
const ROOM_MIN_HEIGHT = 340;
const ROOM_GAP = 32;

export interface PlacedTable {
  table: FloorTable;
  x: number;
  y: number;
}

export interface KrokiRoom {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  tables: PlacedTable[];
}

export interface KrokiLayout {
  rooms: KrokiRoom[];
  width: number;
  height: number;
}

const isPlaced = (table: FloorTable) => Boolean(table.posX || table.posY);

const overlaps = (x: number, y: number, placed: PlacedTable[]) =>
  placed.some((item) => Math.abs(item.x - x) < CELL - 10 && Math.abs(item.y - y) < CELL - 10);

/**
 * Kayıtlı konum olduğu gibi çizilir: başka masa yakında diye ya da oda büyüdü diye kaymaz.
 * Yalnız hiç yerleştirilmemiş (0,0) masalar boş hücrelere dizilir; bu yerleşim aynı veriyle her zaman aynıdır.
 */
export function placeTables(tables: FloorTable[]): PlacedTable[] {
  const placed: PlacedTable[] = tables.filter(isPlaced).map((table) => ({ table, x: table.posX, y: table.posY }));
  const waiting = tables.filter((table) => !isPlaced(table));
  const columns = Math.max(3, Math.ceil(Math.sqrt(tables.length * 1.5)));
  let cell = 0;
  for (const table of waiting) {
    let x: number;
    let y: number;
    do {
      x = PADDING + (cell % columns) * CELL;
      y = PADDING + Math.floor(cell / columns) * CELL;
      cell += 1;
    } while (overlaps(x, y, placed));
    placed.push({ table, x, y });
  }
  return placed;
}

/** Editör açılırken yerleşmemiş masalara ekranda görünen yer kalıcı taslak konumu olur; sonradan sıçramaz. */
export function materializeAutoPlacement(zones: { id: string }[], tables: FloorTable[]): { tables: FloorTable[]; placedIds: string[] } {
  const positions = new Map<string, { x: number; y: number }>();
  for (const zone of zones) {
    for (const item of placeTables(tables.filter((table) => table.zoneId === zone.id))) {
      if (!isPlaced(item.table)) positions.set(item.table.id, { x: item.x, y: item.y });
    }
  }
  return {
    tables: tables.map((table) => {
      const position = positions.get(table.id);
      return position ? { ...table, posX: position.x, posY: position.y } : table;
    }),
    placedIds: [...positions.keys()],
  };
}

interface KrokiObjectBox {
  zoneId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * Kısımlar kareye yakın ızgaraya dizilir: 2 yan yana, 3-4 iki satır, 5-6 üç sütun.
 * Oda boyutu yalnız içeriğe göre büyür; masa ve kapı koordinatları odadan bağımsızdır.
 */
export function buildKroki(zones: { id: string; name: string }[], tables: FloorTable[], objects: KrokiObjectBox[] = []): KrokiLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(zones.length)));
  const sized = zones.map((zone) => {
    const placed = placeTables(tables.filter((table) => table.zoneId === zone.id));
    const bounds = [
      ...placed.map((item) => rotatedBounds({ x: item.x, y: item.y, width: TABLE_SIZE, height: TABLE_SIZE }, item.table.rotation ?? 0)),
      ...objects.filter((object) => object.zoneId === zone.id).map((object) => rotatedBounds(object, object.rotation ?? 0)),
    ];
    return {
      zone,
      placed,
      width: Math.max(ROOM_MIN_WIDTH, ...bounds.map((box) => box.x + box.width + PADDING)),
      height: Math.max(ROOM_MIN_HEIGHT, ...bounds.map((box) => box.y + box.height + PADDING + HEADER)),
    };
  });

  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(0, ...sized.filter((_, index) => index % columns === column).map((room) => room.width)),
  );
  const rowCount = Math.ceil(sized.length / columns);
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(0, ...sized.filter((_, index) => Math.floor(index / columns) === row).map((room) => room.height)),
  );
  const offset = (sizes: number[], index: number) => sizes.slice(0, index).reduce((total, size) => total + size + ROOM_GAP, 0);

  const rooms = sized.map(({ zone, placed }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: zone.id,
      name: zone.name,
      left: offset(columnWidths, column),
      top: offset(rowHeights, row),
      width: columnWidths[column],
      height: rowHeights[row],
      tables: placed,
    };
  });

  return {
    rooms,
    width: offset(columnWidths, columns) - ROOM_GAP,
    height: Math.max(0, offset(rowHeights, rowCount) - ROOM_GAP),
  };
}
