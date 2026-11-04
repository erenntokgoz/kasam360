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
  // Stoktan açılan kalem kendiliğinden satışa çıkmaz; satış fiyatını menü yönetimi belirler.
  const result = await invokeIPC<Parameters<typeof mapProduct>[0]>('create_product', {
    ...auth, name: input.name.trim(), categoryId: input.categoryId, stockUnit: input.stockUnit,
    priceCents: 0, isActive: false, is86: false, taxRateBp: 1000,
    barcode: null, description: null, imageUrl: null, sku: null, color: null, stockoutReason: null,
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
