import { describe, expect, it } from 'vitest';
import { isLowPerformanceDevice } from './perfMode';

const base = { userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120' } as Navigator;

describe('isLowPerformanceDevice', () => {
  it('az bellekli Android cihazı düşük sayar', () => {
    expect(isLowPerformanceDevice({ ...base, deviceMemory: 2, hardwareConcurrency: 8 } as never)).toBe(true);
  });
  it('az çekirdekli Android cihazı düşük sayar', () => {
    expect(isLowPerformanceDevice({ ...base, deviceMemory: 8, hardwareConcurrency: 4 } as never)).toBe(true);
  });
  it('güçlü Android cihazı düşük saymaz', () => {
    expect(isLowPerformanceDevice({ ...base, deviceMemory: 8, hardwareConcurrency: 8 } as never)).toBe(false);
  });
  it('Android olmayan platformu etkilemez', () => {
    expect(isLowPerformanceDevice({ userAgent: 'Windows NT 10.0', deviceMemory: 2, hardwareConcurrency: 2 } as never)).toBe(false);
  });
});
