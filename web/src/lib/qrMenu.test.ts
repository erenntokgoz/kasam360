import { describe, expect, it } from 'vitest';
import { filterCategories, formatMenuPrice, normalizeSearch } from '@/lib/menuView';
import { isMenuHost, resolveMenuHostRewrite } from '@/lib/menuHost';
import { displayName, isValidSlug, parsePublicMenu, titleFromSlug } from '@/lib/qrMenu';

const sha = 'a'.repeat(64);
const body = {
  schema: 'kasam360.qrmenu.v1', slug: 'kafe-x', version: 7, publishedAt: '2026-11-10T09:00:00.000Z', currency: 'TRY',
  categories: [
    { id: 'cat_1', name: 'İçecekler', sortOrder: 10, products: [
      { id: 'prd_1', name: 'Türk Kahvesi', description: 'Orta şekerli.', priceCents: 12500, sortOrder: 10, inStock: true, image: `/public/menu/kafe-x/images/${sha}.webp` },
      { id: 'prd_2', name: 'Ihlamur', description: '   ', priceCents: 9000, sortOrder: 20, inStock: false, image: 'https://evil.example/x.png' },
    ] },
    { id: 'cat_2', name: 'Boş', sortOrder: 20, products: [] },
  ],
};

describe('parsePublicMenu', () => {
  it('sözleşme gövdesini çözer, boş kategoriyi ve yabancı görseli düşürür', () => {
    const menu = parsePublicMenu(body);
    expect(menu.categories).toHaveLength(1);
    expect(menu.categories[0].products[0].image).toBe(`/public/menu/kafe-x/images/${sha}.webp`);
    expect(menu.categories[0].products[1].image).toBeNull();
    expect(menu.categories[0].products[1].description).toBeNull();
    expect(menu.categories[0].products[1].inStock).toBe(false);
  });
  it('bozuk veriyi reddeder', () => {
    expect(() => parsePublicMenu({ ...body, schema: 'x' })).toThrow();
    const bad = structuredClone(body);
    bad.categories[0].products[0].priceCents = 12.5;
    expect(() => parsePublicMenu(bad)).toThrow();
    bad.categories[0].products[0].priceCents = -1;
    expect(() => parsePublicMenu(bad)).toThrow();
  });
  it('işletme adı yoksa adresten türetir', () => {
    expect(titleFromSlug('kafe-x')).toBe('Kafe X');
    expect(titleFromSlug('izmir-kebap')).toBe('İzmir Kebap');
    expect(displayName(parsePublicMenu(body))).toBe('Kafe X');
    expect(displayName(parsePublicMenu({ ...body, name: ' Kafe Xenia ' }))).toBe('Kafe Xenia');
  });
});

describe('menü görünümü', () => {
  it('fiyatı biçimler', () => {
    expect(formatMenuPrice(125_050, 'TRY')).toBe('1.250,50 TL');
    expect(formatMenuPrice(500, 'EUR')).toBe('5,00 EUR');
  });
  it('Türkçe harfe duyarlı arar', () => {
    expect(normalizeSearch('  ILHAMUR ')).toBe('ilhamur');
    const menu = parsePublicMenu(body);
    expect(filterCategories(menu.categories, 'kahve')[0].products.map((p) => p.id)).toEqual(['prd_1']);
    expect(filterCategories(menu.categories, 'IHLAMUR')[0].products.map((p) => p.id)).toEqual(['prd_2']);
    expect(filterCategories(menu.categories, 'yok')).toEqual([]);
    expect(filterCategories(menu.categories, '  ')).toBe(menu.categories);
  });
});

describe('menü alt alanı', () => {
  it('slug yolunu menü rotasına yazar', () => {
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', '/kafe-x')).toBe('/m/kafe-x');
    expect(resolveMenuHostRewrite('menu.localhost:3000', '/kafe-x/')).toBe('/m/kafe-x');
  });
  it('görsel ve statik yolları geçirir, ana site sayfalarını sızdırmaz', () => {
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', `/public/menu/kafe-x/images/${sha}.webp`)).toBeNull();
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', '/_next/static/a.js')).toBeNull();
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', '/')).toBe('/m/-');
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', '/a/b')).toBe('/m/-');
    expect(resolveMenuHostRewrite('menu.kasam360.com.tr', '/ab')).toBe('/m/-');
  });
  it('ana sitede dokunmaz', () => {
    expect(resolveMenuHostRewrite('kasam360.com.tr', '/kafe-x')).toBeNull();
    expect(isMenuHost('menu.kasam360.com.tr')).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('a--b')).toBe(false);
  });
});
