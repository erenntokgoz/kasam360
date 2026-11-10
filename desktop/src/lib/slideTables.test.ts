import { describe, expect, it } from 'vitest';
import { unrotatedSize } from './slideTables';

describe('unrotatedSize', () => {
  it('dönüşsüz kutuyu olduğu gibi bırakır', () => {
    expect(unrotatedSize({ width: 110, height: 110 }, 0)).toEqual({ width: 110, height: 110 });
  });

  it('45 derece dönmüş karenin sınır kutusundan gerçek kenarı geri verir', () => {
    const bounds = 110 * Math.SQRT2;
    const size = unrotatedSize({ width: bounds, height: bounds }, 45);
    expect(size.width).toBeCloseTo(110);
    expect(size.height).toBeCloseTo(110);
  });

  it('90 derecede kare aynı kalır', () => {
    expect(unrotatedSize({ width: 110, height: 110 }, 90).width).toBeCloseTo(110);
  });
});
