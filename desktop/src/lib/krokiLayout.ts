import type { FloorTable } from '../types/floor';

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
  /** Yukarı ve sola çekilen masa için oda bu kadar genişler; konumlara eklenir. */
  offsetX: number;
  offsetY: number;
  tables: PlacedTable[];
}

export interface KrokiLayout {
  rooms: KrokiRoom[];
  width: number;
  height: number;
}

const overlaps = (x: number, y: number, placed: PlacedTable[]) =>
  placed.some((item) => Math.abs(item.x - x) < CELL - 10 && Math.abs(item.y - y) < CELL - 10);

/** Yerleştirilmemiş masalar boş hücrelere dizilir: kullanıcı sürükleyene kadar üst üste binmez. */
function placeTables(tables: FloorTable[]): PlacedTable[] {
  const placed: PlacedTable[] = [];
  const waiting: FloorTable[] = [];
  // Üst üste kaydedilmiş masa okunamaz: ikincisi boş hücreye dizilir.
  for (const table of tables) {
    const isPlaced = Boolean(table.posX || table.posY);
    if (isPlaced && !overlaps(table.posX, table.posY, placed)) placed.push({ table, x: table.posX, y: table.posY });
    else waiting.push(table);
  }
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

/**
 * Kısımlar kareye yakın ızgaraya dizilir: 2 yan yana, 3-4 iki satır, 5-6 üç sütun.
 * Tek yöne uzayan kroki ekrana sığmaz; sütun ve satır en büyük odaya göre genişler.
 */
export function buildKroki(zones: { id: string; name: string }[], tables: FloorTable[]): KrokiLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(zones.length)));
  const sized = zones.map((zone) => {
    const placed = placeTables(tables.filter((table) => table.zoneId === zone.id));
    const offsetX = PADDING - Math.min(PADDING, ...placed.map((item) => item.x));
    const offsetY = PADDING - Math.min(PADDING, ...placed.map((item) => item.y));
    return {
      zone,
      placed,
      offsetX,
      offsetY,
      width: Math.max(ROOM_MIN_WIDTH, ...placed.map((item) => item.x + offsetX + TABLE_SIZE + PADDING)),
      height: Math.max(ROOM_MIN_HEIGHT, ...placed.map((item) => item.y + offsetY + TABLE_SIZE + PADDING + HEADER)),
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

  const rooms = sized.map(({ zone, placed, offsetX, offsetY }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: zone.id,
      name: zone.name,
      left: offset(columnWidths, column),
      top: offset(rowHeights, row),
      width: columnWidths[column],
      height: rowHeights[row],
      offsetX,
      offsetY,
      tables: placed,
    };
  });

  return {
    rooms,
    width: offset(columnWidths, columns) - ROOM_GAP,
    height: Math.max(0, offset(rowHeights, rowCount) - ROOM_GAP),
  };
}

/** Kayıt konumu oda içidir ve negatif olamaz: geçici taşma kalıcı düzene çevrilir. */
export function settledPositions(zones: { id: string; name: string }[], tables: FloorTable[]): Map<string, { x: number; y: number }> {
  const settled = new Map<string, { x: number; y: number }>();
  for (const room of buildKroki(zones, tables).rooms) {
    for (const { table, x, y } of room.tables) settled.set(table.id, { x: x + room.offsetX, y: y + room.offsetY });
  }
  return settled;
}
