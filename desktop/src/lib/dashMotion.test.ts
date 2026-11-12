import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAnimate } from './dashMotion';

function stubBrowser(reduced: boolean, perf?: string) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
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
