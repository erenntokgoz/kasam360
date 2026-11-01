import { describe, expect, it } from 'vitest';
import { applyPercentBp, formatNumber, groupNumber, parsePercentBp, toRawNumber } from './numberText';

describe('sayı metni', () => {
  it('harfi ve binlik noktasını atar', () => {
    expect(toRawNumber('12a3', 'integer')).toBe('123');
    expect(toRawNumber('1.234.567', 'money')).toBe('1234567');
    expect(toRawNumber('abc', 'money')).toBe('');
  });

  it('ondalık hane sayısını türe göre sınırlar', () => {
    expect(toRawNumber('12,345', 'money')).toBe('12,34');
    expect(toRawNumber('12,3456', 'quantity')).toBe('12,345');
    expect(toRawNumber('12,5', 'integer')).toBe('125');
  });

  it('sondaki noktayı virgül sayar ve baştaki sıfırı atar', () => {
    expect(toRawNumber('1.234.', 'money')).toBe('1234,');
    expect(toRawNumber('007', 'money')).toBe('7');
    expect(toRawNumber(',5', 'money')).toBe('0,5');
  });

  it('kimlik ve PIN alanında sıfırları korur', () => {
    expect(toRawNumber('0012a', 'digits')).toBe('0012');
  });

  it('binlikleri ayırır', () => {
    expect(groupNumber('123456789')).toBe('123.456.789');
    expect(groupNumber('1234,5')).toBe('1.234,5');
    expect(groupNumber('1234,')).toBe('1.234,');
    expect(groupNumber('1.5')).toBe('1,5');
    expect(formatNumber(123456789)).toBe('123.456.789');
  });

  it('yüzdeyi kayan nokta kullanmadan baz puana çevirir', () => {
    expect(parsePercentBp('12,5')).toBe(1250);
    expect(parsePercentBp('1,15')).toBe(115);
    expect(parsePercentBp('15')).toBe(1500);
    expect(parsePercentBp('')).toBeNull();
  });

  it('zammı arka uçla aynı yuvarlar', () => {
    expect(applyPercentBp(4500, 1000)).toBe(4950);
    expect(applyPercentBp(1005, 1250)).toBe(1131);
    expect(applyPercentBp(333, 115)).toBe(337);
  });
});
