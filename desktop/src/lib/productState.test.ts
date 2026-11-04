import { describe, expect, it } from 'vitest';
import type { ProductDto, ProductFilters } from '../types/menu';
import { filterMenuProducts, isOnSale, menuProducts } from './productState';

const urun = (id: string, extra: Partial<ProductDto> = {}): ProductDto => ({
  id, name: id, categoryId: 'cat_1', priceCents: 1000, isActive: true, is86: false, isRaw: false, ...extra,
});
const hepsi: ProductFilters = { tukendi: false, satista: false, satisDisi: false, categoryId: null };
const urunler = [
  urun('Çay', { sku: 'İÇK-01' }),
  urun('Ayran', { is86: true }),
  urun('Eski Tost', { isActive: false }),
  urun('Bayat Kek', { isActive: false, is86: true }),
  urun('Un', { isRaw: true, isActive: false }),
];
const adlar = (list: ProductDto[]) => list.map((item) => item.name);

describe('menü ürün süzgeci', () => {
  it('hammaddeyi menüde göstermez', () => {
    expect(adlar(menuProducts(urunler))).not.toContain('Un');
    expect(adlar(filterMenuProducts(urunler, 'un', hepsi, {}))).toEqual([]);
  });

  it('tükendi ve satış dışını ayrı süzer', () => {
    expect(adlar(filterMenuProducts(urunler, '', { ...hepsi, tukendi: true }, {}))).toEqual(['Ayran', 'Bayat Kek']);
    expect(adlar(filterMenuProducts(urunler, '', { ...hepsi, satisDisi: true }, {}))).toEqual(['Eski Tost', 'Bayat Kek']);
    expect(adlar(filterMenuProducts(urunler, '', { ...hepsi, satista: true }, {}))).toEqual(['Çay']);
    expect(isOnSale(urun('x', { is86: true }))).toBe(false);
  });

  it('adı ve stok kodunu Türkçe harf farkı gözetmeden arar', () => {
    expect(adlar(filterMenuProducts(urunler, 'CAY', hepsi, {}))).toEqual(['Çay']);
    expect(adlar(filterMenuProducts(urunler, 'ick-01', hepsi, {}))).toEqual(['Çay']);
  });

  it('üst kategori seçilince alt kategorinin ürünlerini gösterir', () => {
    const list = [urun('Latte', { categoryId: 'cat_sicak' }), urun('Kola', { categoryId: 'cat_soguk' })];
    expect(adlar(filterMenuProducts(list, '', { ...hepsi, categoryId: 'cat_icecek' }, { cat_sicak: 'cat_icecek' }))).toEqual(['Latte']);
  });
});
