import { describe, expect, it } from 'vitest';
import { foldText, matchesProduct } from './searchText';

describe('ürün arama', () => {
  it('Türkçe karakter ve büyük harf farkını yok sayar', () => {
    expect(foldText('IZGARA Köfte')).toBe('izgara kofte');
    expect(matchesProduct('ızgara', 'Izgara Köfte')).toBe(true);
    expect(matchesProduct('KOFTE', 'Izgara Köfte')).toBe(true);
    expect(matchesProduct('şiş', 'TAVUK ŞİŞ')).toBe(true);
  });

  it('barkodu birebir eşler', () => {
    expect(matchesProduct('8690001', 'Ayran', '8690001')).toBe(true);
    expect(matchesProduct('869', 'Ayran', '8690001')).toBe(false);
  });

  it('boş arama her ürünü gösterir', () => {
    expect(matchesProduct('  ', 'Ayran')).toBe(true);
  });
});
