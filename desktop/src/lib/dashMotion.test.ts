import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAnimate } from './dashMotion';

function stubBrowser(reduced: boolean, perf?: string) {
  // Masaüstü varsayılanı tam animasyondur; sistem tercihini sınamak için "system" seçilir.
  const store = { getItem: () => 'system' };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }), localStorage: store });
  vi.stubGlobal('document', { documentElement: { dataset: perf ? { perf } : {} } });
}

describe('canAnimate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hareket azaltma istenmediğinde ve cihaz düşük değilken çalışır', () => {
    stubBrowser(false);
    expect(canAnimate()).toBe(true);
  });

  it('düşük cihazda kapalıdır', () => {
    stubBrowser(false, 'low');
    expect(canAnimate()).toBe(false);
  });

  it('hareket azaltma isteyen kullanıcıda kapalıdır', () => {
    stubBrowser(true);
    expect(canAnimate()).toBe(false);
  });
});
