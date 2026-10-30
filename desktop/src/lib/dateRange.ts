export type RangeKey = 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH';

export interface ReportPeriod {
  from: string;
  to: string;
  /** Karşılaştırılan dönem bu kadar saniye öncedir. */
  compareSeconds: number;
  compareLabel: string;
}

const DAY_SECONDS = 86_400;

export const RANGE_LABELS: Record<RangeKey, string> = {
  TODAY: 'Bugün',
  YESTERDAY: 'Dün',
  WEEK: '7 Gün',
  MONTH: '30 Gün',
};

export const utcOffsetMinutes = (date = new Date()): number => -date.getTimezoneOffset();

const two = (value: number) => String(value).padStart(2, '0');

/** Yerel saatle RFC 3339. `toISOString` UTC verir; gün sınırı yanlış düşerdi. */
export function toLocalIso(date: Date): string {
  const offset = utcOffsetMinutes(date);
  const sign = offset >= 0 ? '+' : '-';
  const hours = two(Math.floor(Math.abs(offset) / 60));
  const minutes = two(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}${sign}${hours}:${minutes}`
  );
}

function dayStart(date: Date, daysAgo: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo);
}

function dayEnd(date: Date, daysAgo: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo, 23, 59, 59);
}

/** Süren dönem kıyas için aynı saate kadar alınır: yarım gün tam günle ölçülmez. */
export function reportPeriod(key: RangeKey, now = new Date()): ReportPeriod {
  switch (key) {
    case 'TODAY':
      return { from: toLocalIso(dayStart(now, 0)), to: toLocalIso(now), compareSeconds: DAY_SECONDS, compareLabel: 'dün aynı saate göre' };
    case 'YESTERDAY':
      return { from: toLocalIso(dayStart(now, 1)), to: toLocalIso(dayEnd(now, 1)), compareSeconds: DAY_SECONDS, compareLabel: 'önceki güne göre' };
    case 'WEEK':
      return { from: toLocalIso(dayStart(now, 6)), to: toLocalIso(now), compareSeconds: 7 * DAY_SECONDS, compareLabel: 'önceki 7 güne göre' };
    case 'MONTH':
      return { from: toLocalIso(dayStart(now, 29)), to: toLocalIso(now), compareSeconds: 30 * DAY_SECONDS, compareLabel: 'önceki 30 güne göre' };
  }
}
