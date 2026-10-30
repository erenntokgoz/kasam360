import { describe, expect, it } from 'vitest';
import { mapKdsOrders } from './kdsStore';

describe('mutfak biletleri', () => {
  it('sunucu adisyonunu istasyonlara böler ve durumları korur', () => {
    const tickets = mapKdsOrders([
      {
        id: 'ord_1',
        orderNumber: '1',
        tableNumber: 'Masa 4',
        waiterName: 'Ayşe',
        createdAt: '2026-10-30T10:00:00Z',
        elapsedSeconds: 125,
        items: [
          { id: 'itm_1', name: 'Tost', quantity: 2, status: 'Pending', station: 'MUTFAK' },
          { id: 'itm_2', name: 'Kola', quantity: 1, status: 'Ready', station: 'BAR' },
        ],
      },
    ]);
    expect(tickets.map((t) => t.station)).toEqual(['MUTFAK', 'BAR']);
    expect(tickets[0]).toMatchObject({ orderId: 'ord_1', tableName: 'Masa 4', elapsedMinutes: 2 });
    expect(tickets[1].items[0]).toMatchObject({ orderItemId: 'itm_2', status: 'READY' });
  });

  it('masasız adisyonu tezgâh olarak gösterir', () => {
    const [ticket] = mapKdsOrders([
      {
        id: 'ord_2', orderNumber: '2', tableNumber: null, createdAt: '2026-10-30T10:00:00Z', elapsedSeconds: 0,
        items: [{ id: 'itm_1', name: 'Çay', quantity: 1 }],
      },
    ]);
    expect(ticket).toMatchObject({ tableName: 'Tezgâh', station: 'MUTFAK' });
  });
});
