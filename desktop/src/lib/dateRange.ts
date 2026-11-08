export type RangeKey = 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH';
export interface CalendarRange { from: string; to: string }
export type PanoramaRange = RangeKey | CalendarRange | { month: string };

// Pano servisi en fazla 93 günlük grafik döndürür; seçili dönem sessizce kırpılmamalı.
export const MAX_CALENDAR_RANGE_DAYS = 93;

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

function calendarDay(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function calendarMonthRange(month: string): CalendarRange {
  const first = calendarDay(`${month}-01`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { from: `${month}-01`, to: toLocalIso(last).slice(0, 10) };
}

export function validCalendarRange({ from, to }: CalendarRange): boolean {
  const utcDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const day = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value ? day : NaN;
  };
  const daysApart = (utcDay(to) - utcDay(from)) / (DAY_SECONDS * 1000);
  return daysApart >= 0 && daysApart < MAX_CALENDAR_RANGE_DAYS;
}

/** Süren dönem kıyas için aynı saate kadar alınır: yarım gün tam günle ölçülmez. */
export function reportPeriod(key: PanoramaRange, now = new Date()): ReportPeriod {
  if (typeof key !== 'string') {
    const range = 'month' in key ? calendarMonthRange(key.month) : key;
    const start = calendarDay(range.from);
    const lastDay = calendarDay(range.to);
    const nextDay = dayStart(lastDay, -1);
    return {
      from: toLocalIso(start),
      to: toLocalIso(dayEnd(lastDay, 0)),
      compareSeconds: (nextDay.getTime() - start.getTime()) / 1000,
      compareLabel: 'önceki eşit döneme göre',
    };
  }
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
