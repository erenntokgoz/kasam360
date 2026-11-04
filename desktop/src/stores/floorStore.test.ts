import { describe, expect, it } from 'vitest';
import { mapFloorRow } from './floorStore';

const row = { id: 'tbl_1', name: 'Masa 1', status: 'AVAILABLE', currentTotal: 0, seats: 4, x: 0, y: 0 };

describe('salon planı', () => {
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
