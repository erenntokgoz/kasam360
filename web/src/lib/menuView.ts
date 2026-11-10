import { formatMoney, formatMoneyAmount } from '@/lib/formatMoney';
import type { MenuCategory } from '@/lib/qrMenu';

// Para birimi TRY ise ortak formatMoney ("1.250,50 TL"); başka birimde tutar aynı kuralla, birim kodu sonda yazılır.
export function formatMenuPrice(cents: number, currency: string): string {
  return currency === 'TRY' ? formatMoney(cents) : `${formatMoneyAmount(cents)} ${currency}`;
}

// Arama Türkçe büyük/küçük harf kuralıyla yapılır ve aksan farkını yok sayar ("Ihlamur" ile "ıhlamur" eşleşir).
export function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}

// Yalnız ürün adında arar; eşleşen ürünü olmayan kategori düşer. Boş arama listeyi aynen döndürür.
export function filterCategories(categories: MenuCategory[], query: string): MenuCategory[] {
  const needle = normalizeSearch(query);
  if (!needle) return categories;
  return categories
    .map((category) => ({ ...category, products: category.products.filter((product) => normalizeSearch(product.name).includes(needle)) }))
    .filter((category) => category.products.length > 0);
}

// Kategori bölümünün sayfa içi bağlantı kimliği; sözleşme kimlikleri güvenli karakterlerdir.
export const sectionId = (categoryId: string) => `kat-${categoryId}`;
