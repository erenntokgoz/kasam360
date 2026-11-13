import { describe, expect, it } from 'vitest';
import { hourlyWindow, peakHour, type HourSales } from './hourlyWindow';

const day = (sales: Record<number, number>): HourSales[] =>
  Array.from({ length: 24 }, (_, hour) => ({ hour, collectedCents: sales[hour] ?? 0, orders: sales[hour] ? 1 : 0 }));

describe('saatlik dağılım penceresi', () => {
  it('satış yoksa boş döner', () => {
    expect(hourlyWindow(day({}))).toEqual([]);
    expect(peakHour(day({}))).toBeNull();
  });

  it('gece boş saatleri keser, aradaki satışsız saati korur', () => {
    const window = hourlyWindow(day({ 10: 500, 14: 900 }));
    expect(window[0].hour).toBe(8);
    expect(window[window.length - 1].hour).toBe(14);
    expect(window.find((item) => item.hour === 12)?.collectedCents).toBe(0);
  });

  it('gece yarısından sonraki satış pencereyi o saate açar', () => {
    const window = hourlyWindow(day({ 1: 300, 22: 700 }));
    expect(window[0].hour).toBe(1);
    expect(window[window.length - 1].hour).toBe(22);
  });

  it('en yoğun saati bulur', () => {
    expect(peakHour(day({ 12: 100, 21: 900, 22: 400 }))?.hour).toBe(21);
  });
});
