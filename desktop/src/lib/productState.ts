import type { ProductDto, ProductFilters } from '../types/menu';
import { matchesProduct } from './searchText';

/** Menü yalnız satış ürünlerini listeler; hammadde stok ve reçete ekranlarındadır. */
export function menuProducts(products: ProductDto[]): ProductDto[] {
  return products.filter((product) => !product.isRaw);
}

/**
 * Tükendi geçicidir (stok bitti, gün içinde döner); satış dışı kalıcı karardır.
 * İkisi ayrı alanlarda tutulur ve aynı anda doğru olabilir.
 */
export function isOnSale(product: ProductDto): boolean {
  return product.isActive && !product.is86;
}

/** Kategori süzgecinde üst kategori seçilince alt kategorinin ürünleri de görünür. */
export function filterMenuProducts(
  products: ProductDto[],
  query: string,
  filters: ProductFilters,
  parents: Record<string, string | null | undefined>,
): ProductDto[] {
  return menuProducts(products).filter((product) => {
    if (!matchesProduct(query, product.name, product.barcode, product.sku)) return false;
    if (filters.categoryId && product.categoryId !== filters.categoryId && parents[product.categoryId] !== filters.categoryId) {
      return false;
    }
    if (filters.tukendi && !product.is86) return false;
    if (filters.satisDisi && product.isActive) return false;
    if (filters.satista && !isOnSale(product)) return false;
    return true;
  });
}
