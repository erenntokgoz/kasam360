export interface HourSales {
  hour: number;
  collectedCents: number;
  orders: number;
}

const WORK_DAY_START = 8;
const MIN_SPAN = 6;

/**
 * Gece boş saatler grafiği sıkıştırmasın: gün başı 08:00 ya da ilk satış saatinden başlar,
 * son satış saatinde biter. Aradaki satışsız saat silinmez; yoğunluk boşluğuyla birlikte okunur.
 */
export function hourlyWindow(hourly: HourSales[]): HourSales[] {
  const used = hourly.filter((item) => item.collectedCents > 0).map((item) => item.hour);
  if (used.length === 0) return [];
  const first = Math.min(WORK_DAY_START, ...used);
  const last = Math.min(23, Math.max(first + MIN_SPAN, ...used));
  return hourly.filter((item) => item.hour >= first && item.hour <= last);
}

/** En çok tahsilat alınan saat; hiç satış yoksa boş. */
export function peakHour(hourly: HourSales[]): HourSales | null {
  return hourly.reduce<HourSales | null>(
    (best, item) => (item.collectedCents > 0 && (best === null || item.collectedCents > best.collectedCents) ? item : best),
    null,
  );
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
