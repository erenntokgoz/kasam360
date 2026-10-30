import { describe, expect, it } from 'vitest';
import { errorCode, errorText, parseCents } from './cariInput';

describe('parseCents', () => {
  it('Türkçe ve düz yazımı float kullanmadan çevirir', () => {
    expect(parseCents('1.250,50')).toBe(125050);
    expect(parseCents('1250,5')).toBe(125050);
    expect(parseCents('19,99')).toBe(1999);
    expect(parseCents('0,07')).toBe(7);
    expect(parseCents('45 ₺')).toBe(4500);
    expect(parseCents('12.50')).toBe(1250);
  });

  it('geçersiz girişte sıfır varsaymaz', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('-5')).toBeNull();
    expect(parseCents('12,345')).toBeNull();
    expect(parseCents('abc')).toBeNull();
  });
});

describe('hata metni', () => {
  it('kodu gerekçeden ayırır', () => {
    expect(errorCode('CONFLICT: bakiye değişti')).toBe('CONFLICT');
    expect(errorText('CONFLICT: bakiye değişti')).toBe('bakiye değişti');
    expect(errorCode(new Error('düz hata'))).toBeNull();
  });
});
