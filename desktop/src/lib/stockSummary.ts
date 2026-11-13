import type { StockBatch } from '../types/stock';

export interface StockRow {
  productId: string;
  quantity: number;
  /** Kalan partilerin kuruş değeri; her parti kuruşa yuvarlanır, float toplam tutulmaz. */
  valueCents: number;
  /** Ağırlıklı ortalama birim maliyet; stok yoksa `null` (sıfır maliyet uydurulmaz). */
  averageCostCents: number | null;
  /** En yakın son kullanma tarihi (`YYYY-AA-GG`), tarihli parti yoksa `null`. */
  nearestExpiry: string | null;
}

export interface StockTotals {
  inStock: number;
  outOfStock: number;
  valueCents: number;
  /** Önümüzdeki `expiryDays` gün içinde (geçmişler dahil) sona erecek tarihli ürün sayısı. */
  expiring: number;
}

export const EXPIRY_WARNING_DAYS = 7;

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Ürün başına stok satırı. Partisi olmayan ürün de satır alır: "Stok Yok" bilgisi kaybolmaz. */
export function stockRows(productIds: string[], batches: StockBatch[]): Map<string, StockRow> {
  const rows = new Map<string, StockRow>();
  for (const id of productIds) rows.set(id, { productId: id, quantity: 0, valueCents: 0, averageCostCents: null, nearestExpiry: null });
  for (const batch of batches) {
    const row = rows.get(batch.productId);
    if (!row) continue;
    row.quantity += batch.remainingQuantity;
    row.valueCents += Math.round(batch.remainingQuantity * batch.unitCostCents);
    if (batch.expiryDate && (row.nearestExpiry === null || batch.expiryDate < row.nearestExpiry)) {
      row.nearestExpiry = batch.expiryDate;
    }
  }
  for (const row of rows.values()) {
    row.averageCostCents = row.quantity > 0 ? Math.round(row.valueCents / row.quantity) : null;
  }
  return rows;
}

export function stockTotals(rows: Iterable<StockRow>, now = new Date()): StockTotals {
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + EXPIRY_WARNING_DAYS);
  const limitKey = dayKey(limit);
  const totals: StockTotals = { inStock: 0, outOfStock: 0, valueCents: 0, expiring: 0 };
  for (const row of rows) {
    if (row.quantity > 0) totals.inStock += 1;
    else totals.outOfStock += 1;
    totals.valueCents += row.valueCents;
    if (row.nearestExpiry !== null && row.nearestExpiry <= limitKey) totals.expiring += 1;
  }
  return totals;
}

/**
 * Stok listesine yalnız stok tutulan kalemler girer: hammaddeler ve partisi olan satış ürünleri.
 * Reçetesiz satış ürünü (ör. kutu içecek) partisi varsa doğrudan FIFO ile düşüldüğü için listede kalır;
 * partisi olmayan satış ürünü (Espresso gibi reçeteli ya da stoksuz menü ürünü) menüden yönetilir.
 */
export function stockTrackedIds(
  products: ReadonlyArray<{ id: string; isRaw: boolean }>,
  batches: ReadonlyArray<{ productId: string }>,
): Set<string> {
  const withBatch = new Set(batches.map((batch) => batch.productId));
  return new Set(products.filter((product) => product.isRaw || withBatch.has(product.id)).map((product) => product.id));
}
