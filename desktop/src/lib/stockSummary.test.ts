import { describe, expect, it } from 'vitest';
import type { StockBatch } from '../types/stock';
import { stockRows, stockTotals } from './stockSummary';

const batch = (extra: Partial<StockBatch>): StockBatch => ({
  id: 'bat_1', productId: 'prd_1', productName: 'Un', stockUnit: 'kg', remainingQuantity: 1, unitCostCents: 1000,
  receivedAt: '2026-11-01T10:00:00+03:00', expiryDate: null, usableGramsPerUnit: null, ...extra,
});

describe('stok özeti', () => {
  it('ağırlıklı ortalama maliyet ve kuruş değerini partilerden hesaplar', () => {
    const rows = stockRows(['prd_1'], [
      batch({ id: 'bat_1', remainingQuantity: 2, unitCostCents: 1000 }),
      batch({ id: 'bat_2', remainingQuantity: 3, unitCostCents: 1500 }),
    ]);
    const row = rows.get('prd_1');
    expect(row?.quantity).toBe(5);
    expect(row?.valueCents).toBe(6500);
    expect(row?.averageCostCents).toBe(1300);
  });

  it('kesirli miktarı parti başına kuruşa yuvarlar', () => {
    const row = stockRows(['prd_1'], [batch({ remainingQuantity: 0.333, unitCostCents: 1000 })]).get('prd_1');
    expect(row?.valueCents).toBe(333);
  });

  it('partisiz ürün stok yok sayılır ve maliyet uydurulmaz', () => {
    const rows = stockRows(['prd_1', 'prd_2'], [batch({})]);
    expect(rows.get('prd_2')).toMatchObject({ quantity: 0, valueCents: 0, averageCostCents: null });
  });

  it('listede olmayan ürünün partisini yok sayar', () => {
    const rows = stockRows(['prd_1'], [batch({ productId: 'prd_x', remainingQuantity: 9 })]);
    expect(rows.get('prd_1')?.quantity).toBe(0);
    expect(rows.has('prd_x')).toBe(false);
  });

  it('toplamlar stok durumunu ve yaklaşan son kullanma tarihini sayar', () => {
    const rows = stockRows(['prd_1', 'prd_2', 'prd_3'], [
      batch({ productId: 'prd_1', expiryDate: '2026-11-12' }),
      batch({ id: 'bat_2', productId: 'prd_2', expiryDate: '2026-12-30' }),
    ]);
    const totals = stockTotals(rows.values(), new Date(2026, 10, 10));
    expect(totals).toEqual({ inStock: 2, outOfStock: 1, valueCents: 2000, expiring: 1 });
  });
});
