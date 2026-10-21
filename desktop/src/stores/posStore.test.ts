import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from './posStore';

describe('posStore - Adisyon ve Masa İzolasyonu', () => {
  beforeEach(() => {
    usePosStore.setState({
      activeTableId: 'tbl_01',
      activeTableName: 'Masa 01',
      isWalkin: false,
      ticketItems: [],
      tableTickets: {},
      tablePaidCents: {},
    });
  });

  it('farklı masalara geçildiğinde adisyon kalemleri birbirine karışmaz', () => {
    const store = usePosStore.getState();

    // Masa 01'e 1 adet ürün ekle
    store.openOrderForTable('tbl_01', 'Masa 01', 2);
    usePosStore.getState().addItemToTicket({
      id: 'prod_tost',
      categoryId: 'cat_fast',
      name: 'Karışık Tost',
      unitPriceCents: 15000,
      vatRate: 10,
      station: 'MUTFAK',
      isAvailable: true,
    });

    expect(usePosStore.getState().ticketItems.length).toBe(1);
    expect(usePosStore.getState().calculateTotalCents()).toBe(15000);

    // Masa 03'e geç (boş masa)
    usePosStore.getState().openOrderForTable('tbl_03', 'Masa 03', 2);
    expect(usePosStore.getState().ticketItems.length).toBe(0);
    expect(usePosStore.getState().calculateTotalCents()).toBe(0);

    // Masa 01'e geri dön (tost korunmalı)
    usePosStore.getState().openOrderForTable('tbl_01', 'Masa 01', 2);
    expect(usePosStore.getState().ticketItems.length).toBe(1);
    expect(usePosStore.getState().ticketItems[0].name).toBe('Karışık Tost');
    expect(usePosStore.getState().calculateTotalCents()).toBe(15000);
  });

  it('Kalem Bazlı Böl (deductPaidItems) yalnızca ödenen kalemleri sepetten düşer', () => {
    usePosStore.getState().openOrderForTable('tbl_01', 'Masa 01', 2);
    usePosStore.getState().addItemToTicket({
      id: 'prod_burger',
      categoryId: 'cat_fast',
      name: '360 Smash Burger',
      unitPriceCents: 26000,
      vatRate: 10,
      station: 'MUTFAK',
      isAvailable: true,
    });
    usePosStore.getState().addItemToTicket({
      id: 'prod_cola',
      categoryId: 'cat_drink',
      name: 'Kola',
      unitPriceCents: 5500,
      vatRate: 10,
      station: 'BAR',
      isAvailable: true,
    });

    const items = usePosStore.getState().ticketItems;
    expect(items.length).toBe(2);

    const burgerItem = items.find((i) => i.productId === 'prod_burger')!;
    usePosStore.getState().deductPaidItems({ [burgerItem.id]: 1 });

    const remaining = usePosStore.getState().ticketItems;
    expect(remaining.length).toBe(1);
    expect(remaining[0].name).toBe('Kola');
    expect(usePosStore.getState().calculateTotalCents()).toBe(5500);
  });

  it('Tutar Bazlı Böl (deductPaidAmount) kalan bakiye hesaplamasını doğru günceller', () => {
    usePosStore.getState().openOrderForTable('tbl_01', 'Masa 01', 2);
    usePosStore.getState().addItemToTicket({
      id: 'prod_burger',
      categoryId: 'cat_fast',
      name: '360 Smash Burger',
      unitPriceCents: 26000,
      vatRate: 10,
      station: 'MUTFAK',
      isAvailable: true,
    });

    expect(usePosStore.getState().calculateTotalCents()).toBe(26000);

    // 100 TL kısmi tahsilat yap
    usePosStore.getState().deductPaidAmount(10000);
    expect(usePosStore.getState().calculateTotalCents()).toBe(16000);

    // Kalan 160 TL tahsil edildiğinde bakiye 0 olur
    usePosStore.getState().deductPaidAmount(16000);
    expect(usePosStore.getState().calculateTotalCents()).toBe(0);
  });
});
