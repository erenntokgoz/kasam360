import type { PanoramaData } from '../stores/panoramaStore';
import { formatMoney } from './formatMoney';

/** Değişim yüzdesi. Önceki dönem boşsa oran anlamsızdır; sonsuz büyüme gösterilmez. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 100) / previous);
}

/** Margin yüzdesi; ciro yoksa veya maliyet görünmüyorsa boş döner. */
export function marginPercent(profitCents: number | null, revenueCents: number): number | null {
  if (profitCents === null || revenueCents <= 0) return null;
  return Math.round((profitCents * 100) / revenueCents);
}

/** Yalnız kayıtlı rakamlardan cümle kurar; veri yoksa cümle de yoktur. */
export function buildInsights(data: PanoramaData, compareLabel: string): string[] {
  const lines: string[] = [];
  const { current, previous, buckets, bucketKind, products } = data;
  if (current.collectedCents <= 0) return lines;

  const change = percentChange(current.collectedCents, previous.collectedCents);
  if (change !== null && change !== 0) {
    lines.push(`Ciro ${compareLabel} %${Math.abs(change)} ${change > 0 ? 'yukarıda' : 'aşağıda'}.`);
  }
  const busiest = buckets.reduce((best, item) => (item.currentCents > best.currentCents ? item : best), buckets[0]);
  if (busiest && busiest.currentCents > 0) {
    const label = bucketKind === 'HOUR' ? `${busiest.label}:00` : busiest.label.split('-').reverse().slice(0, 2).join('.');
    lines.push(`En yoğun ${bucketKind === 'HOUR' ? 'saat' : 'gün'} ${label}: ${formatMoney(busiest.currentCents)}.`);
  }
  const best = [...products]
    .filter((item) => item.profitCents !== null)
    .sort((a, b) => (b.profitCents ?? 0) - (a.profitCents ?? 0))[0];
  if (best && (best.profitCents ?? 0) > 0) {
    lines.push(`En çok kazandıran ürün ${best.name}: ${formatMoney(best.profitCents ?? 0)} kâr.`);
  }
  if (current.refundCents + current.voidCents > 0) {
    const lost = current.refundCents + current.voidCents;
    lines.push(`İptal ve iade ${formatMoney(lost)}, cironun %${Math.round((lost * 100) / current.collectedCents)} kadarı.`);
  }
  return lines;
}
