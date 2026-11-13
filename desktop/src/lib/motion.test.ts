import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMotionForced, setMotionForced } from './motion';
import { isSlowFrameSample } from './perfMode';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } },
  });
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
});
afterEach(() => vi.unstubAllGlobals());

describe('hareket tercihi', () => {
  it('masaüstünde varsayılan tam animasyondur', () => {
    expect(isMotionForced()).toBe(true);
  });
  it('Sistem Ayarı seçimi saklanır', () => {
    setMotionForced(false);
    expect(isMotionForced()).toBe(false);
    setMotionForced(true);
    expect(isMotionForced()).toBe(true);
  });
});

describe('isSlowFrameSample', () => {
  it('akıcı örneği zayıf saymaz', () => {
    expect(isSlowFrameSample(Array(40).fill(16.7))).toBe(false);
  });
  it('20 kare/sn altı ortancayı zayıf sayar', () => {
    expect(isSlowFrameSample(Array(40).fill(80))).toBe(true);
  });
  it('az örnekle karar vermez', () => {
    expect(isSlowFrameSample(Array(5).fill(200))).toBe(false);
  });
});
