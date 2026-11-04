import { formatNumber } from './numberText';
import type { StockBatch } from '../types/stock';

/** Gramlı parti adedin yanında bir adetten çıkan gramı gösterir; reçete gramı bu partiden düşer. */
export function batchQuantityText(batch: Pick<StockBatch, 'remainingQuantity' | 'stockUnit' | 'usableGramsPerUnit'>): string {
  const base = `${formatNumber(batch.remainingQuantity)} ${batch.stockUnit}`;
  return batch.usableGramsPerUnit ? `${base} · ${formatNumber(batch.usableGramsPerUnit)} g/adet` : base;
}
