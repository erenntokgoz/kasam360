import { describe, expect, it } from 'vitest';
import type { FloorTable } from '../types/floor';
import { buildKroki, materializeAutoPlacement, placeTables } from './krokiLayout';

const zones = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `z${index}`, name: `Kısım ${index}` }));

const table = (id: string, zoneId: string, posX = 0, posY = 0) =>
  ({ id, zoneId, posX, posY, tableNumber: id, zoneName: zoneId, capacity: 4, status: 'EMPTY', totalCents: 0, width: 110, height: 110 }) as FloorTable;

const positions = (count: number) => buildKroki(zones(count), []).rooms.map((room) => `${room.left > 0 ? 'y' : 'x'}${room.top > 0 ? 'a' : 'u'}`);

describe('buildKroki', () => {
  it('kısımlar hem yana hem alta büyür', () => {
    expect(positions(2)).toEqual(['xu', 'yu']);
    expect(positions(3)).toEqual(['xu', 'yu', 'xa']);
    expect(positions(4)).toEqual(['xu', 'yu', 'xa', 'ya']);
    const nine = buildKroki(zones(9), []);
    expect(new Set(nine.rooms.map((room) => room.left)).size).toBe(3);
    expect(new Set(nine.rooms.map((room) => room.top)).size).toBe(3);
  });

  it('yerleşmemiş masalar üst üste binmez, yerleşmiş masa korunur', () => {
    const tables = [table('a', 'z0', 30, 30), table('b', 'z0'), table('c', 'z0')];
    const [room] = buildKroki(zones(1), tables).rooms;
    const spots = room.tables.map((item) => `${item.x}:${item.y}`);
    expect(new Set(spots).size).toBe(3);
    expect(spots[0]).toBe('30:30');
  });

  it('oda masalara göre büyür, komşu odalar çakışmaz', () => {
    const { rooms } = buildKroki(zones(2), [table('a', 'z0', 1200, 900)]);
    expect(rooms[0].width).toBeGreaterThan(1200);
    expect(rooms[1].left).toBeGreaterThanOrEqual(rooms[0].width);
    expect(rooms[1].height).toBe(rooms[0].height);
  });

  it('kapı ve pencere ölçülerini de oda sınırına katar, masa koordinatına dokunmaz', () => {
    const tables = [table('a', 'z0', 120, 160)];
    const object = { zoneId: 'z0', x: 1300, y: 900, width: 140, height: 24 };
    const [room] = buildKroki(zones(1), tables, [object]).rooms;
    expect(room.width).toBeGreaterThanOrEqual(1470);
    expect(room.height).toBeGreaterThanOrEqual(1010);
    expect(room.tables[0]).toMatchObject({ x: 120, y: 160 });
  });

  it('kapı ve masa aynı oda içi koordinatı kullanır, hiçbirine kaydırma eklenmez', () => {
    const tables = [table('a', 'z0', 30, 30)];
    const object = { zoneId: 'z0', x: 50, y: 20, width: 140, height: 24 };
    const [room] = buildKroki(zones(1), tables, [object]).rooms;
    expect(room.tables[0]).toMatchObject({ x: 30, y: 30 });
    expect('offsetX' in room).toBe(false);
  });

  it('dönmüş kapının köşelerini oda sınırında tutar', () => {
    const object = { zoneId: 'z0', x: 0, y: 900, width: 152, height: 24, rotation: 45 };
    const [room] = buildKroki(zones(1), [], [object]).rooms;
    const radians = Math.PI / 4;
    const rotatedHeight = Math.abs(object.width * Math.sin(radians)) + Math.abs(object.height * Math.cos(radians));
    const top = object.y + (object.height - rotatedHeight) / 2;
    expect(room.height).toBeGreaterThanOrEqual(top + rotatedHeight + 30 + 56);
  });

  it('kayıtlı masalar yakın olsa da yerinde kalır', () => {
    const [room] = buildKroki(zones(1), [table('a', 'z0', 200, 200), table('b', 'z0', 230, 210)]).rooms;
    expect(room.tables.map((item) => [item.x, item.y])).toEqual([[200, 200], [230, 210]]);
  });

  it('yerleşmemiş masa kayıtlı masanın üstüne düşmez', () => {
    const items = placeTables([table('a', 'z0', 30, 30), table('b', 'z0')]);
    expect([items[0].x, items[0].y]).toEqual([30, 30]);
    expect([items[1].x, items[1].y]).not.toEqual([30, 30]);
  });

  it('açılışta otomatik yerleşim taslağa yazılır; bir masa taşınınca diğerleri sıçramaz', () => {
    const tables = [table('a', 'z0', 30, 30), table('b', 'z0'), table('c', 'z0')];
    const { tables: settled, placedIds } = materializeAutoPlacement(zones(1), tables);
    expect(placedIds).toEqual(['b', 'c']);
    const spot = (items: ReturnType<typeof placeTables>, id: string) => items.filter((item) => item.table.id === id).map((item) => [item.x, item.y]);
    const before = placeTables(settled);
    const after = placeTables(settled.map((item) => (item.id === 'a' ? { ...item, posX: 900, posY: 700 } : item)));
    expect(spot(after, 'b')).toEqual(spot(before, 'b'));
    expect(spot(after, 'c')).toEqual(spot(before, 'c'));
  });

  it('döndürülmüş masanın köşeleri oda boyutuna katılır', () => {
    const plain = buildKroki(zones(1), [table('a', 'z0', 1000, 600)]).rooms[0];
    const turned = buildKroki(zones(1), [{ ...table('a', 'z0', 1000, 600), rotation: 45 }]).rooms[0];
    expect(turned.width).toBeGreaterThan(plain.width);
  });

  it('400 masada da hepsi yerleşir', () => {
    const tables = Array.from({ length: 400 }, (_, index) => table(`t${index}`, 'z0'));
    const [room] = buildKroki(zones(1), tables).rooms;
    expect(new Set(room.tables.map((item) => `${item.x}:${item.y}`)).size).toBe(400);
  });
});
