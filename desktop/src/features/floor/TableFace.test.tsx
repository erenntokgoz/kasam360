import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableFace } from './TableFace';
import type { FloorTable } from '../../types/floor';

const occupiedTable: FloorTable = {
  id: 'table-1',
  tableNumber: 'Salon Uzun Masa 12',
  zoneId: 'salon',
  zoneName: 'Salon',
  capacity: 8,
  status: 'OCCUPIED',
  totalCents: 987654321,
  openedAt: '2026-11-08 08:00:00',
  waiterName: 'Ahmet Yılmaz',
  posX: 0,
  posY: 0,
  width: 100,
  height: 100,
};

describe('TableFace erişilebilir içeriği', () => {
  it('butonun erişilebilir adında tam masa adı, tutar, garson ve süreyi içerir', () => {
    const html = renderToStaticMarkup(<TableFace table={occupiedTable} />);

    expect(html).toMatch(/aria-label="Salon Uzun Masa 12, 8 kişilik, 9\.876\.543,21 ₺, Ahmet Yılmaz, \d+ dk"/);
    expect(html).toMatch(/Ahmet Yılmaz · \d+ dk/);
  });
});
