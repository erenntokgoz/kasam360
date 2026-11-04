import { describe, expect, it } from 'vitest';
import { hoursText, recentPeriods } from './payPeriod';

const sunday = new Date(2026, 10, 8);

describe('hakediş dönemleri', () => {
  it('hafta pazartesi başlar, pazar günü de aynı haftadır', () => {
    expect(recentPeriods('WEEKLY', sunday)[0]).toEqual({ key: '2026-11-02', label: '02.11 - 08.11' });
    expect(recentPeriods('WEEKLY', new Date(2026, 10, 2))[0].key).toBe('2026-11-02');
    expect(recentPeriods('WEEKLY', sunday)[1].key).toBe('2026-10-26');
  });

  it('gün ve ay geriye gider, yıl sınırını aşar', () => {
    expect(recentPeriods('DAILY', sunday).slice(0, 2).map((item) => item.key)).toEqual(['2026-11-08', '2026-11-07']);
    expect(recentPeriods('MONTHLY', new Date(2027, 0, 15)).map((item) => item.key)).toEqual(['2027-01', '2026-12', '2026-11']);
  });

  it('saat tek ondalıkla yuvarlanır', () => {
    expect(hoursText(27_000)).toBe('7,5');
    expect(hoursText(0)).toBe('0,0');
    expect(hoursText(3_599)).toBe('1,0');
    expect(hoursText(179)).toBe('0,0');
  });
});
