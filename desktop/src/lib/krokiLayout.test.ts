import { describe, expect, it } from 'vitest';
import type { FloorTable } from '../types/floor';
import { buildKroki, settledPositions } from './krokiLayout';

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

  it('yukarı ve sola çekilen masa odayı o yönde büyütür, kayıtta negatif kalmaz', () => {
    const tables = [table('a', 'z0', 30, 30), table('b', 'z0', -170, -270)];
    const [room] = buildKroki(zones(1), tables).rooms;
    expect([room.offsetX, room.offsetY]).toEqual([200, 300]);
    expect(room.height).toBeGreaterThanOrEqual(30 + 300 + 110);
    const settled = settledPositions(zones(1), tables);
    expect(settled.get('b')).toEqual({ x: 30, y: 30 });
    expect(settled.get('a')).toEqual({ x: 230, y: 330 });
  });

  it('400 masada da hepsi yerleşir', () => {
    const tables = Array.from({ length: 400 }, (_, index) => table(`t${index}`, 'z0'));
    const [room] = buildKroki(zones(1), tables).rooms;
    expect(new Set(room.tables.map((item) => `${item.x}:${item.y}`)).size).toBe(400);
  });
});
