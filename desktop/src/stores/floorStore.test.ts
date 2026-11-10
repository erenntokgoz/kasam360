import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorTable } from '../types/floor';
import { mapFloorObject, mapFloorRow, useFloorStore } from './floorStore';

const invokeIPC = vi.hoisted(() => vi.fn());
vi.mock('../services/tauriClient', () => ({ invokeIPC }));
vi.mock('./cariStore', () => ({ sessionArgs: () => ({ actorRole: 'OWNER', actorId: 'usr_1', tenantId: 'ten_1' }) }));

const row = { id: 'tbl_1', name: 'Masa 1', status: 'AVAILABLE', currentTotal: 0, seats: 4, x: 0, y: 0 };

describe('salon planı', () => {
  it('mimari öğeyi kroki modeline çevirir', () => {
    expect(mapFloorObject({ id: 'obj_1', zone_id: 'salon', kind: 'WINDOW', label: 'Balkon', x: 120, y: 240, width: 180, height: 24, rotation: 0, is_active: true }))
      .toEqual({ id: 'obj_1', zoneId: 'salon', kind: 'WINDOW', label: 'Balkon', x: 120, y: 240, width: 180, height: 24, rotation: 0, isActive: true });
  });
  it('sunucu masasını ekran modeline çevirir', () => {
    expect(mapFloorRow({ ...row, zone: 'Teras' })).toMatchObject({
      tableNumber: 'Masa 1', zoneId: 'Teras', capacity: 4, status: 'EMPTY',
    });
  });

  it('bölümsüz masa Salon sayılır, açık tutar korunur', () => {
    const table = mapFloorRow({ ...row, status: 'OCCUPIED', currentTotal: 3300, guestCount: 2 });
    expect(table).toMatchObject({ zoneId: 'Salon', status: 'OCCUPIED', totalCents: 3300, occupiedSeats: 2 });
  });

  it('bilinmeyen durum boş masa sayılmaz', () => {
    expect(mapFloorRow({ ...row, status: 'YENI' }).status).toBe('OCCUPIED');
  });
});

describe('kroki açı ve konum kalıcılığı', () => {
  const planRow = { ...row, id: 'tbl_a', zone: 'zon_1', x: 240, y: 120 };

  beforeEach(() => {
    invokeIPC.mockReset();
    useFloorStore.setState({ zones: [], tables: [], objects: [] });
  });

  it('düzen okumasındaki masa açısını salon masasına bağlar, açısı olmayana 0 verir', async () => {
    invokeIPC.mockImplementation(async (command: string) => {
      if (command === 'get_floor_plan') return [planRow, { ...planRow, id: 'tbl_b', name: 'Masa 2' }];
      return { zones: [{ id: 'zon_1', name: 'Salon' }], tables: [{ id: 'tbl_a', rotation: 135 }], objects: [] };
    });
    await useFloorStore.getState().loadFloorPlan();
    const byId = new Map(useFloorStore.getState().tables.map((table) => [table.id, table]));
    expect(byId.get('tbl_a')).toMatchObject({ posX: 240, posY: 120, rotation: 135, zoneId: 'zon_1' });
    expect(byId.get('tbl_b')?.rotation).toBe(0);
  });

  it('kayıtta masa açısını sıfırlamaz, konumu tamsayıya yuvarlar', async () => {
    invokeIPC.mockResolvedValue(undefined);
    useFloorStore.setState({ zones: [{ id: 'zon_1', name: 'Salon', tableCount: 1 }] });
    const table = { ...mapFloorRow({ ...planRow, zone: 'zon_1' }), posX: 250.4, posY: 119.6, rotation: 270 } as FloorTable;
    await useFloorStore.getState().saveFloorLayout({ tables: [table], objects: [], newObjects: [], deletedObjectIds: [] });
    const save = invokeIPC.mock.calls.find(([command]) => command === 'save_floor_layout');
    expect(save?.[1].args.tables[0]).toMatchObject({ table_id: 'tbl_a', x: 250, y: 120, rotation: 270, zone_id: 'zon_1' });
  });

  it('kapı ve pencere açısını kayıt gövdesine taşır', async () => {
    invokeIPC.mockResolvedValue(undefined);
    const object = { id: 'obj_1', zoneId: 'zon_1', kind: 'DOOR' as const, label: 'Kapı', x: 10, y: 20, width: 140, height: 24, rotation: 45, isActive: true };
    await useFloorStore.getState().saveFloorLayout({ tables: [], objects: [object], newObjects: [{ ...object, id: 'draft:1', rotation: 90 }], deletedObjectIds: [] });
    const body = invokeIPC.mock.calls.find(([command]) => command === 'save_floor_layout')?.[1].args;
    expect(body.objects[0].rotation).toBe(45);
    expect(body.new_objects[0].rotation).toBe(90);
  });
});
