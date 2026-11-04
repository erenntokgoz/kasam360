import type { CategoryDto, ProductDto } from '../types/menu';
import { useAuthStore } from '../stores/authStore';
import { invokeIPC } from '../services/tauriClient';
import { mapCategory, mapProduct } from './menuWire';

export interface StockItemInput { name: string; categoryId: string; stockUnit: string }
function context() {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || auth.mustChangePin || auth.user?.role !== 'OWNER') {
    throw new Error('Kayıt oluşturmak için işletme sahibi oturumu gerekli.');
  }
  return { tenantId: auth.user.tenantId, actorId: auth.user.userId, actorRole: auth.user.role };
}

export async function createStockItem(input: StockItemInput): Promise<ProductDto> {
  const auth = context();
  if (!input.name.trim() || !input.categoryId || !['adet', 'g', 'kg', 'ml', 'l'].includes(input.stockUnit)) {
    throw new Error('Ad, kategori ve geçerli stok birimi gerekli.');
  }
  // Stoktan ve reçeteden açılan kalem hammaddedir: menüde görünmez, satışa çıkmaz.
  const result = await invokeIPC<Parameters<typeof mapProduct>[0]>('create_product', {
    ...auth, name: input.name.trim(), categoryId: input.categoryId, stockUnit: input.stockUnit,
    priceCents: 0, isActive: false, is86: false, taxRateBp: 1000, isRaw: true,
    barcode: null, description: null, imageUrl: null, sku: null, color: null, stockoutReason: null,
  });
  return mapProduct(result);
}

/**
 * Hammadde ile satış ürünü arasında dönüşüm. Satış ürününe çevrilen kalem kapalı kalır:
 * fiyatı ve satışa açılması menüden yapılır. Diğer alanlar olduğu gibi geri yazılır.
 */
export async function setProductRaw(product: ProductDto, isRaw: boolean): Promise<ProductDto> {
  const auth = context();
  const result = await invokeIPC<Parameters<typeof mapProduct>[0]>('update_product', {
    ...auth, id: product.id, categoryId: product.categoryId, name: product.name,
    priceCents: product.priceCents, imageUrl: product.imageUrl ?? null, isActive: isRaw ? false : product.isActive,
    sku: product.sku ?? null, barcode: product.barcode ?? null, taxRateBp: product.taxRateBp ?? 1000,
    description: product.description ?? null, color: product.color ?? null, is86: product.is86,
    stockoutReason: product.stockoutReason ?? null, stockUnit: product.stockUnit ?? 'adet', isRaw,
  });
  return mapProduct(result);
}

export async function createStockCategory(name: string): Promise<CategoryDto> {
  const auth = context();
  if (!name.trim()) throw new Error('Kategori adı gerekli.');
  const result = await invokeIPC<Parameters<typeof mapCategory>[0]>('create_category', {
    ...auth, name: name.trim(), displayOrder: 0, icon: null, defaultStation: null,
  });
  return mapCategory(result);
}
