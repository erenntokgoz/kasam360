import { describe, expect, it } from 'vitest';
import { fromDateTimeLocalValue, toDateTimeLocalValue, toLocalRfc3339 } from './localTime';

describe('yerel RFC3339', () => {
  it('yerel saati ofsetiyle yazar ve aynı anı korur', () => {
    const date = new Date(2026, 10, 9, 22, 5, 7);
    const text = toLocalRfc3339(date);
    expect(text).toMatch(/^2026-11-09T22:05:07[+-]\d{2}:\d{2}$/);
    expect(new Date(text).getTime()).toBe(date.getTime());
  });

  it('gece yarısından sonraki giriş yerel günde kalır', () => {
    const date = new Date(2026, 10, 10, 1, 0, 0);
    expect(toLocalRfc3339(date).startsWith('2026-11-10T01:00:00')).toBe(true);
  });

  it('datetime-local değerini gidiş dönüşte korur ve geçersizi reddeder', () => {
    const date = new Date(2026, 10, 10, 6, 30, 0);
    expect(toDateTimeLocalValue(date)).toBe('2026-11-10T06:30');
    expect(fromDateTimeLocalValue('2026-11-10T06:30')?.getTime()).toBe(date.getTime());
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('2026-11-10')).toBeNull();
  });
});
