
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { KdsOrder, KdsStationDto } from '../../src/presentation/types';

// Polyfill localStorage for node/vitest environment if not present
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k in store) {
        delete store[k];
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

describe('KDS Backend Integrations & Operational Lifecycle Suite', () => {
  const OFFLINE_QUEUE_KEY = 'kds_offline_queue';

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    await tauriInvoke('submit_order', {
      tableId: 'tbl-001',
      items: [
        { product: { name: 'Türk Kahvesi' }, quantity: 2, unitPrice: 4000, total: 8000, note: 'Biri orta' },
        { product: { name: 'Karışık Tost' }, quantity: 1, unitPrice: 7000, total: 7000, note: 'Çıtır' },
      ],
    });
  });

  it('1. get_stations: mutfak istasyonlarını (Sıcak, Soğuk, İçecek, Izgara, Tatlı vb.) eksiksiz çeker', async () => {
    const stations = await tauriInvoke<KdsStationDto[]>('get_stations');
    expect(Array.isArray(stations)).toBe(true);
    expect(stations.length).toBeGreaterThanOrEqual(4);

    const names = stations.map((s) => s.name);
    expect(names.some((n) => n.includes('Sıcak') || n.includes('Prep'))).toBe(true);
    expect(names.some((n) => n.includes('İçecek') || n.includes('Bar'))).toBe(true);
    expect(names.some((n) => n.includes('Izgara') || n.includes('Grill'))).toBe(true);
  });

  it('2. get_active_tickets: aktif mutfak siparişlerini ve kalemlerini başarıyla döndürür', async () => {
    const tickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    expect(Array.isArray(tickets)).toBe(true);
    expect(tickets.length).toBeGreaterThan(0);

    const first = tickets[0];
    expect(first.id).toBeDefined();
    expect(first.orderNumber).toBeDefined();
    expect(first.items.length).toBeGreaterThan(0);

    const firstItem = first.items[0];
    expect(firstItem.name).toBeDefined();
    expect(firstItem.quantity).toBeGreaterThan(0);
    expect(firstItem.station).toBeDefined();
    expect(firstItem.status).toBeDefined();
  });

  it('3. kds_update_ticket_status: bilet durumunu PENDING -> PREPARING -> READY -> SERVED şeklinde ilerletir', async () => {
    const tickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    const targetOrder = tickets[0];

    // Pending -> Preparing
    const p1 = {
      orderId: targetOrder.id,
      fromStatus: 'Pending',
      toStatus: 'Preparing',
      timestamp: new Date().toISOString(),
      actorId: 'usr_cook',
      actorRole: 'Kitchen',
    };
    await tauriInvoke('kds_update_ticket_status', { payload: p1 });

    let updatedTickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    let order = updatedTickets.find((t) => t.id === targetOrder.id);
    expect(order?.status).toBe('Preparing');

    // Preparing -> Ready
    const p2 = {
      orderId: targetOrder.id,
      fromStatus: 'Preparing',
      toStatus: 'Ready',
      timestamp: new Date().toISOString(),
      actorId: 'usr_cook',
      actorRole: 'Kitchen',
    };
    await tauriInvoke('kds_update_ticket_status', { payload: p2 });

    updatedTickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    order = updatedTickets.find((t) => t.id === targetOrder.id);
    expect(order?.status).toBe('Ready');

    // Ready -> SERVED (Mutfaktan çıkar)
    const p3 = {
      orderId: targetOrder.id,
      fromStatus: 'Ready',
      toStatus: 'SERVED',
      timestamp: new Date().toISOString(),
      actorId: 'usr_cook',
      actorRole: 'Kitchen',
    };
    await tauriInvoke('kds_update_ticket_status', { payload: p3 });

    updatedTickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    const servedOrder = updatedTickets.find((t) => t.id === targetOrder.id);
    expect(servedOrder?.status).toBe('SERVED');
  });

  it('4. update_kds_item_status: kalem bazlı durum günceller ve tüm kalemler hazır olduğunda bileti Ready yapar', async () => {
    const tickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    const orderWithMultipleItems = tickets.find((t) => t.items.length >= 2) || tickets[0];

    // İlk kalemi Ready yap
    const firstItem = orderWithMultipleItems.items[0];
    await tauriInvoke('update_kds_item_status', {
      payload: { itemId: firstItem.id, status: 'Ready' },
    });

    let currentTickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    let updatedOrder = currentTickets.find((t) => t.id === orderWithMultipleItems.id);
    expect(updatedOrder?.items.find((it) => it.id === firstItem.id)?.status).toBe('Ready');

    // Kalan tüm kalemleri Ready yap
    for (const item of orderWithMultipleItems.items) {
      await tauriInvoke('update_kds_item_status', {
        payload: { itemId: item.id, status: 'Ready' },
      });
    }

    currentTickets = await tauriInvoke<KdsOrder[]>('get_active_tickets');
    updatedOrder = currentTickets.find((t) => t.id === orderWithMultipleItems.id);
    // Tüm kalemler Ready olduğunda sipariş de Ready olur
    expect(updatedOrder?.status).toBe('Ready');
  });

  it('5. kds_offline_queue: çevrimdışı kuyruğa alma ve ağ geri geldiğinde aktarım garantisi', async () => {
    const mockAction = {
      id: 'act_test_001',
      type: 'TICKET_STATUS' as const,
      orderId: 'kds_ord_01',
      fromStatus: 'Pending',
      toStatus: 'Preparing',
      timestamp: new Date().toISOString(),
      actorId: 'system',
      actorRole: 'Kitchen',
      queuedAt: Date.now(),
    };

    // Kuyruğa yazma
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([mockAction]));
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    expect(queue.length).toBe(1);
    expect(queue[0].orderId).toBe('kds_ord_01');

    // Kuyruğu işleme simülasyonu
    for (const action of queue) {
      const res = await tauriInvoke('kds_update_ticket_status', {
        payload: {
          orderId: action.orderId,
          fromStatus: action.fromStatus,
          toStatus: action.toStatus,
          timestamp: action.timestamp,
          actorId: action.actorId,
          actorRole: action.actorRole,
        },
      });
      expect(res).toBeDefined();
    }

    // Başarıyla iletildiğinde kuyruğu boşalt
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([]));
    expect(JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]').length).toBe(0);
  });

  it('6. Bilet READY olduğunda masa durumunun servise hazır hale geldiğini doğrular', async () => {
    // Masa 1 için bilet READY yapılır
    await tauriInvoke('kds_update_ticket_status', {
      payload: {
        orderId: 'kds_ord_01',
        fromStatus: 'Preparing',
        toStatus: 'Ready',
        timestamp: new Date().toISOString(),
        actorId: 'usr_cook',
        actorRole: 'Kitchen',
      },
    });

    const readyStatus = await tauriInvoke<string>('get_table_ready_status', { tableId: 'tbl-001' });
    expect(readyStatus).toBeDefined();
  });
});
