import type { ProductDto } from '../types/menu';
import { useAuthStore } from '../stores/authStore';
import { invokeIPC } from '../services/tauriClient';
import { mapProduct } from './menuWire';

/** Stok kalemi menüde yer almaz; kategorisi yoktur. Kalem = ad + stok birimi. */
export interface StockItemInput { name: string; stockUnit: string }
function context() {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || auth.mustChangePin || auth.user?.role !== 'OWNER') {
    throw new Error('Kayıt oluşturmak için işletme sahibi oturumu gerekli.');
  }
  return { tenantId: auth.user.tenantId, actorId: auth.user.userId, actorRole: auth.user.role };
}

export async function createStockItem(input: StockItemInput): Promise<ProductDto> {
  const auth = context();
  if (!input.name.trim() || !['adet', 'g', 'kg', 'ml', 'l'].includes(input.stockUnit)) {
    throw new Error('Ad ve geçerli stok birimi gerekli.');
  }
  // Stoktan ve reçeteden açılan kalem hammaddedir: menüde görünmez, satışa çıkmaz.
  const result = await invokeIPC<Parameters<typeof mapProduct>[0]>('create_product', {
    ...auth, name: input.name.trim(), categoryId: null, stockUnit: input.stockUnit,
    priceCents: 0, isActive: false, is86: false, taxRateBp: 1000, isRaw: true,
    barcode: null, description: null, imageUrl: null, sku: null, color: null, stockoutReason: null,
  });
  return mapProduct(result);
}

/**
 * Hammadde ile satış ürünü arasında dönüşüm. Satış ürününe çevrilen kalem kapalı kalır:
 * fiyatı ve satışa açılması menüden yapılır. Satış ürünü menü kategorisi ister;
 * hammaddeye çevrilen kalemin kategorisi düşer.
 */
export async function setProductRaw(product: ProductDto, isRaw: boolean, categoryId?: string): Promise<ProductDto> {
  return updateStockItem(product, { name: product.name, stockUnit: product.stockUnit ?? 'adet' }, isRaw, categoryId);
}

export async function updateStockItem(
  product: ProductDto, input: StockItemInput, isRaw = product.isRaw, categoryId = product.categoryId,
): Promise<ProductDto> {
  const auth = context();
  if (!input.name.trim()) throw new Error('Ad gerekli.');
  if (!isRaw && !categoryId) throw new Error('Satış ürünü için menü kategorisi gerekli.');
  const result = await invokeIPC<Parameters<typeof mapProduct>[0]>('update_product', {
    ...auth, id: product.id, categoryId: isRaw ? null : categoryId, name: input.name.trim(),
    priceCents: product.priceCents, imageUrl: product.imageUrl ?? null, isActive: isRaw ? false : product.isActive,
    sku: product.sku ?? null, barcode: product.barcode ?? null, taxRateBp: product.taxRateBp ?? 1000,
    description: product.description ?? null, color: product.color ?? null, is86: product.is86,
    stockoutReason: product.stockoutReason ?? null, stockUnit: input.stockUnit, isRaw,
  });
  return mapProduct(result);
}

export async function deleteStockItem(id: string): Promise<void> {
  await invokeIPC('delete_product', { ...context(), id });
}
