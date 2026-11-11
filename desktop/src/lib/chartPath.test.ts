import { describe, expect, it } from 'vitest';
import { areaPath, axisLabel, niceAxisMaxLira, smoothPath } from './chartPath';

describe('grafik yolu', () => {
  it('iki noktadan eğri çizer ve başlangıç noktasında başlar', () => {
    const path = smoothPath([{ x: 0, y: 10 }, { x: 100, y: 50 }]);
    expect(path.startsWith('M0 10 C')).toBe(true);
    expect(path.endsWith('100 50')).toBe(true);
  });

  it('düz bölümde eğriyi taşırmaz', () => {
    const path = smoothPath([{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 10 }]);
    // İlk parçanın kontrol noktaları düz çizgide kalır.
    expect(path).toContain('C16.7 50 33.3 50 50 50');
  });

  it('alan yolu tabana kapanır', () => {
    const points = [{ x: 0, y: 10 }, { x: 100, y: 20 }];
    expect(areaPath(smoothPath(points), points, 200).endsWith('L100 200 L0 200 Z')).toBe(true);
    expect(areaPath('M0 0', [{ x: 0, y: 0 }], 200)).toBe('');
  });
});

describe('eksen', () => {
  it('yuvarlak üst sınır seçer', () => {
    expect(niceAxisMaxLira(123_400)).toBe(2000);
    expect(niceAxisMaxLira(0)).toBe(4);
    expect(niceAxisMaxLira(2_400_000)).toBe(40_000);
  });

  it('etiketi kısaltır', () => {
    expect(axisLabel(500)).toBe('500');
    expect(axisLabel(1500)).toBe('1,5B');
    expect(axisLabel(20_000)).toBe('20B');
    expect(axisLabel(2_000_000)).toBe('2M');
  });
});
