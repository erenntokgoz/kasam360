import { describe, it, expect } from 'vitest';
import { formatInstantDay, minutesElapsed } from './date';

describe('minutesElapsed', () => {
  it('SQLite UTC saatini yerel saat sanmaz', () => {
    const past = new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    expect(minutesElapsed(past)).toBe(5);
  });

  it('geçen süreyi tam dakika cinsinden hesaplar', () => {
    const past45m = new Date(Date.now() - 45 * 60000).toISOString();
    expect(minutesElapsed(past45m)).toBe(45);
  });
});

describe('formatInstantDay', () => {
  it('saatli UTC anını yerel güne çevirir, saatsiz tarihi olduğu gibi bırakır', () => {
    const instant = '2026-11-09T22:45:34+00:00';
    const local = new Date(instant);
    const expected = `${String(local.getDate()).padStart(2, '0')}.${String(local.getMonth() + 1).padStart(2, '0')}.${local.getFullYear()}`;
    expect(formatInstantDay(instant)).toBe(expected);
    expect(formatInstantDay('2026-11-10')).toBe('10.11.2026');
    expect(formatInstantDay('2026-11-09 22:45:34')).toBe(expected);
  });
});
