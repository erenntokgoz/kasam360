const two = (value: number) => String(value).padStart(2, '0');

/**
 * Yerel saati ofsetiyle yazar (`2026-11-09T22:00:00+03:00`). Sunucu vardiya gününü yazılan
 * ofsetten çıkarır; UTC metni gece yarısından sonraki girişi bir önceki güne düşürürdü.
 */
export function toLocalRfc3339(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
  return `${day}T${time}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** `datetime-local` alanının değeri (`YYYY-MM-DDTHH:mm`). */
export function toDateTimeLocalValue(date: Date): string {
  return toLocalRfc3339(date).slice(0, 16);
}

/** `datetime-local` metnini yerel zamana çevirir; geçersiz metinde `null`. */
export function fromDateTimeLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
