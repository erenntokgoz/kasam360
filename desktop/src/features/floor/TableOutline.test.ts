import { describe, expect, it } from 'vitest';
import { seatLayout } from './TableOutline';

describe('sandalye dizilimi', () => {
  it('her kapasitede tam o kadar sandalye çizer', () => {
    for (let seats = 1; seats <= 30; seats += 1) {
      const { top, bottom, ends } = seatLayout(seats);
      expect(top + bottom + ends * 2).toBe(seats);
    }
  });

  it('kısa kenar yalnız kalabalık masada kullanılır', () => {
    expect(seatLayout(4)).toEqual({ top: 2, bottom: 2, ends: 0 });
    expect(seatLayout(5)).toEqual({ top: 3, bottom: 2, ends: 0 });
    expect(seatLayout(8)).toEqual({ top: 3, bottom: 3, ends: 1 });
  });
});
