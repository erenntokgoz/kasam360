import { describe, expect, it } from 'vitest';
import type { FloorTable } from '../../types/floor';
import { filterFloorTables, matchesTableFilter } from './floorView';

const tables = [
  { id: 'a', zoneId: 'salon', status: 'EMPTY' },
  { id: 'b', zoneId: 'salon', status: 'OCCUPIED' },
  { id: 'd', zoneId: 'bahce', status: 'EMPTY' },
  { id: 'e', zoneId: 'bahce', status: 'RESERVED', reservationId: 'r1' },
].map((table) => ({ ...table, tableNumber: table.id }) as FloorTable);

describe('filtre salon masaları', () => {
  it('durum ve kısım filtrelerini aynı veri kümesinde uygular', () => {
    expect(filterFloorTables(tables, null, 'ALL').map((table) => table.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(filterFloorTables(tables, null, 'EMPTY').map((table) => table.id)).toEqual(['a', 'd']);
    expect(filterFloorTables(tables, null, 'OCCUPIED').map((table) => table.id)).toEqual(['b']);
    expect(filterFloorTables(tables, null, 'RESERVED').map((table) => table.id)).toEqual(['e']);
    expect(filterFloorTables(tables, 'salon', 'RESERVED')).toEqual([]);
    expect(filterFloorTables(tables, 'salon', 'ALL')).toHaveLength(2);
  });

  it('Tümü 27 / Boş 25 / Dolu 2 / Rezerve 0 senaryosunu üretir', () => {
    const mainRoom = Array.from({ length: 27 }, (_, index) => ({
      ...tables[0],
      id: `main-${index}`,
      zoneId: 'salon',
      status: index < 25 ? 'EMPTY' : 'OCCUPIED',
      reservationId: undefined,
    })) as FloorTable[];
    expect(['ALL', 'EMPTY', 'OCCUPIED', 'RESERVED'].map((filter) =>
      filterFloorTables(mainRoom, 'salon', filter as 'ALL' | 'EMPTY' | 'OCCUPIED' | 'RESERVED').length,
    )).toEqual([27, 25, 2, 0]);
  });

  it('sıfır eşleşmede masa filtresini tümünü göstererek geçersiz kılmaz', () => {
    expect(matchesTableFilter(tables[0], 'RESERVED')).toBe(false);
  });
});
