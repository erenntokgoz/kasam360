import { describe, expect, it } from 'vitest';
import { groupDeliveries, waitLabel } from './deliveryList';

const item = (itemId: string, orderId: string, tableName: string, productName: string, quantity: number, readySeconds: number) => ({
  itemId, orderId, tableName, productName, quantity, readySeconds,
});

describe('teslim listesi', () => {
  it('kalemleri masa başına toplar, en uzun bekleyen masa başta durur', () => {
    const groups = groupDeliveries([
      item('i1', 'o1', 'Masa 4', 'Tost', 2, 60),
      item('i2', 'o2', 'Tezgâh', 'Çay', 1, 400),
      item('i3', 'o1', 'Masa 4', 'Kola', 1, 180),
    ]);
    expect(groups.map((group) => group.tableName)).toEqual(['Tezgâh', 'Masa 4']);
    expect(groups[1]).toMatchObject({ summary: '2× Tost, Kola', itemIds: ['i1', 'i3'], readySeconds: 180 });
  });

  it('boş liste boş grup verir', () => {
    expect(groupDeliveries([])).toEqual([]);
  });

  it('bekleme süresini kısa yazar', () => {
    expect(waitLabel(20)).toBe('az önce');
    expect(waitLabel(-5)).toBe('az önce');
    expect(waitLabel(180)).toBe('3 dk');
    expect(waitLabel(3600)).toBe('1 sa');
    expect(waitLabel(3900)).toBe('1 sa 5 dk');
  });
});
