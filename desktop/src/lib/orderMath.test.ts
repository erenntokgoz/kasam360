import { describe, expect, it } from 'vitest';
import { itemTaxCents, lineTotalCents, mapServerItem, toSubmitItem, unitShareCents } from './orderMath';

const wire = {
  id: 'itm_1',
  product: { id: 'prd_1', name: 'Çay' },
  quantity: 3,
  unitPrice: 91,
  taxRate: 1000,
  total: 300,
};

describe('adisyon hesapları', () => {
  it('satır toplamı KDV tabanını aşağı yuvarlar', () => {
    expect(lineTotalCents(15000, 2)).toBe(30000);
    expect(lineTotalCents(91, 3)).toBe(273);
  });

  it('adetler tek tek ödense de kuruş kaybolmaz', () => {
    const item = mapServerItem({ ...wire, total: 100 });
    if (!item) throw new Error('kalem yok');
    const shares = [0, 1, 2].map((paid) => unitShareCents({ ...item, paidQuantity: paid }, 1));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it('ödenmiş adet düşer, tamamı ödenen satır görünmez', () => {
    const partly = mapServerItem({ ...wire, paidQuantity: 1 });
    expect(partly).toMatchObject({ quantity: 2, totalCents: 200, isSentToKitchen: true });
    expect(mapServerItem({ ...wire, paidQuantity: 3 })).toBeNull();
  });

  it('KDV dahil tutardan KDV payını çıkarır', () => {
    const item = mapServerItem(wire);
    if (!item) throw new Error('kalem yok');
    // 300 kuruş %10 dahil: KDV 27,27 kuruştur, yarım yukarı yuvarlamayla 27.
    expect(itemTaxCents(item)).toBe(27);
  });

  it('gönderilen kalem fiyat taşımaz', () => {
    const item = mapServerItem({ ...wire, note: 'Az şekerli' });
    if (!item) throw new Error('kalem yok');
    const sent = toSubmitItem({ ...item, cookingDegree: 'Orta' });
    expect(sent).not.toHaveProperty('unitPrice');
    expect(sent.note).toBe('Orta · Az şekerli');
  });
});
