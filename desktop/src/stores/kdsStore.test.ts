import { describe, it, expect, beforeEach } from 'vitest';
import { useKdsStore } from './kdsStore';
import type { OrderItem } from '../types/pos';

describe('kdsStore - İstasyon Bazlı Otomatik Fişleme ve Bilet Oluşturma', () => {
  beforeEach(() => {
    useKdsStore.setState({
      tickets: [],
      activeStations: {
        MUTFAK: true,
        BAR: true,
        TATLI: false, // Ekransız istasyon: fiş basılır
      },
      soundEnabled: false,
    });
  });

  it('aktif ekranı olan mutfak ve bar ürünleri canlı KDS biletine eklenir', async () => {
    const items: OrderItem[] = [
      {
        id: 'oi_1',
        productId: 'prod_antrikot',
        name: 'Antrikot',
        quantity: 1,
        unitPriceCents: 48000,
        vatRate: 10,
        station: 'MUTFAK',
        course: 2,
        selectedModifiers: [],
        totalCents: 48000,
        isSentToKitchen: false,
      },
      {
        id: 'oi_2',
        productId: 'prod_cola',
        name: 'Kola',
        quantity: 2,
        unitPriceCents: 5500,
        vatRate: 10,
        station: 'BAR',
        course: 1,
        selectedModifiers: [],
        totalCents: 11000,
        isSentToKitchen: false,
      },
    ];

    const res = await useKdsStore.getState().addTicketsFromOrder('ord_1', 'Masa 04', 'Ahmet G.', items);
    expect(res.addedCount).toBe(2);
    expect(res.autoPrintedStations.length).toBe(0);

    const tickets = useKdsStore.getState().tickets;
    expect(tickets.length).toBe(2);
    expect(tickets.some((t) => t.station === 'MUTFAK')).toBe(true);
    expect(tickets.some((t) => t.station === 'BAR')).toBe(true);
  });

  it('aktif ekranı olmayan tatlı istasyonu siparişi otomatik termal fiş kuyruğuna iletir', async () => {
    const items: OrderItem[] = [
      {
        id: 'oi_3',
        productId: 'prod_sufle',
        name: 'Çikolatalı Sufle',
        quantity: 1,
        unitPriceCents: 17000,
        vatRate: 10,
        station: 'TATLI',
        course: 3,
        selectedModifiers: [],
        totalCents: 17000,
        isSentToKitchen: false,
      },
    ];

    const res = await useKdsStore.getState().addTicketsFromOrder('ord_2', 'Masa 02', 'Ahmet G.', items);
    expect(res.addedCount).toBe(0);
    expect(res.autoPrintedStations).toContain('TATLI');
    // Ekrana düşmez, otomatik yazıcıya uçar
    expect(useKdsStore.getState().tickets.length).toBe(0);
  });
});
