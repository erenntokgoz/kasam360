import { describe, it, expect } from 'vitest';
import { formatMoney } from './formatMoney';

describe('formatMoney - Finansal Kesinlik (INTEGER Cents)', () => {
  it('sıfır kuruş için doğru çıktı üretir', () => {
    expect(formatMoney(0)).toBe('0,00 ₺');
  });

  it('148500 kuruş için binlik noktalı ve virgüllü format üretir', () => {
    expect(formatMoney(148500)).toBe('1.485,00 ₺');
  });

  it('büyük kuruş değerlerinde kuruş kaybı ve float kayması yaşamaz', () => {
    expect(formatMoney(123456789)).toBe('1.234.567,89 ₺');
  });

  it('negatif kuruş tutarlarını eksi işaretiyle formatlar', () => {
    expect(formatMoney(-45000)).toBe('-450,00 ₺');
  });

  it('kuruş hanesini iki basamaklı olarak sıfırla doldurur', () => {
    expect(formatMoney(505)).toBe('5,05 ₺');
    expect(formatMoney(500)).toBe('5,00 ₺');
  });
});
