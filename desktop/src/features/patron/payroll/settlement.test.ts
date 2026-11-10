import { describe, expect, it } from 'vitest';
import { checkPayAmount, netWorkedSeconds } from './settlement';

describe('personel hesabı ödeme tutarı', () => {
  it('kalan borcu aşan, sıfır ve geçersiz tutarı reddeder', () => {
    expect(checkPayAmount('400,00', 112_500)).toEqual({ cents: 40_000, error: null });
    expect(checkPayAmount('1125', 112_500).cents).toBe(112_500);
    expect(checkPayAmount('1125,01', 112_500).error).toBe('Tutar kalan borcu aşıyor.');
    expect(checkPayAmount('0', 112_500).error).toBe('Tutar sıfırdan büyük olmalı.');
    expect(checkPayAmount('abc', 112_500).error).toBe('Tutarı rakamla yazın.');
  });
});

describe('çıkış süresi', () => {
  const start = new Date(2026, 10, 9, 22, 0, 0).toISOString();

  it('gece yarısını aşan vardiyada molayı düşer', () => {
    const end = new Date(2026, 10, 10, 6, 0, 0);
    expect(netWorkedSeconds(start, end, 30)).toBe(27_000);
  });

  it('girişten önceki, 24 saati aşan ve moladan kısa süreyi geçersiz sayar', () => {
    expect(netWorkedSeconds(start, new Date(2026, 10, 9, 21, 0, 0), 0)).toBeNull();
    expect(netWorkedSeconds(start, new Date(2026, 10, 10, 22, 0, 1), 0)).toBeNull();
    expect(netWorkedSeconds(start, new Date(2026, 10, 9, 23, 0, 0), 61)).toBeNull();
    expect(netWorkedSeconds(start, new Date(2026, 10, 9, 23, 0, 0), 60)).toBe(0);
  });
});
