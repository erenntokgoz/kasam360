import { describe, expect, it } from 'vitest';
import { sharesFromMultipliers } from './tipShares';

const sum = (shares: Record<string, number>) => Object.values(shares).reduce((total, value) => total + value, 0);

describe('sharesFromMultipliers', () => {
  it('çarpanla orantılı dağıtır ve toplamı 100 yapar', () => {
    const shares = sharesFromMultipliers([
      { id: 'a', multiplier: 100 },
      { id: 'b', multiplier: 100 },
      { id: 'c', multiplier: 100 },
    ]);
    expect(shares).toEqual({ a: 34, b: 33, c: 33 });
  });

  it('kalan en büyük kesire gider', () => {
    // 150/250 = 60, 100/250 = 40: tam bölünür.
    expect(sharesFromMultipliers([{ id: 'a', multiplier: 150 }, { id: 'b', multiplier: 100 }])).toEqual({ a: 60, b: 40 });
    // 28,57 + 42,86 + 28,57: eksik 2 puan önce b'ye, eşit kalanda listede önce gelen a'ya.
    const shares = sharesFromMultipliers([
      { id: 'a', multiplier: 200 },
      { id: 'b', multiplier: 300 },
      { id: 'c', multiplier: 200 },
    ]);
    expect(shares).toEqual({ a: 29, b: 43, c: 28 });
    expect(sum(shares)).toBe(100);
  });

  it('sıfır çarpanlı kişi pay almaz, hepsi sıfırsa boş döner', () => {
    expect(sharesFromMultipliers([{ id: 'a', multiplier: 0 }, { id: 'b', multiplier: 50 }])).toEqual({ b: 100 });
    expect(sharesFromMultipliers([{ id: 'a', multiplier: 0 }])).toEqual({});
    expect(sharesFromMultipliers([])).toEqual({});
  });
});
