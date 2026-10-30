import { describe, expect, it } from 'vitest';
import { mapBulkPriceResult, mapCategory, mapPriceList, mapProduct } from './menuWire';

describe('canlı menü IPC yanıtları', () => {
  it('ürün ve kategori alanlarını ekrana taşır', () => {
    const product = mapProduct({
      id: 'prd_1', category_id: 'cat_1', name: 'Çay', price_cents: 5000,
      image_url: null, is_active: true, sku: null, barcode: null,
      tax_rate_bp: 1000, description: null, color: null,
      is_86: true, stockout_reason: 'Stok yok', stock_unit: 'adet',
    });
    const category = mapCategory({
      id: 'cat_1', name: 'İçecek', display_order: 1,
      icon: null, default_station: 'BAR',
    });
    expect(product).toMatchObject({ categoryId: 'cat_1', priceCents: 5000, is86: true, stockUnit: 'adet' });
    expect(category).toMatchObject({ displayOrder: 1, defaultStation: 'BAR' });
  });

  it('fiyat listesi ve toplu zam sonucunu taşır', () => {
    const list = mapPriceList({
      id: 'pl_1', name: 'Salon', kind: 'PERAKENDE', valid_from: null,
      valid_to: null, is_active: true,
      items: [{ id: 'pli_1', product_id: 'prd_1', product_name: 'Çay', price_cents: 5500 }],
    });
    const result = mapBulkPriceResult({
      changed: [{ product_id: 'prd_1', product_name: 'Çay', old_price_cents: 5000,
        new_price_cents: 5500, skipped: null }],
      skipped: [], category_id: 'cat_1',
    });
    expect(list.items?.[0]).toMatchObject({ productId: 'prd_1', priceCents: 5500 });
    expect(result.changed).toEqual([{
      productId: 'prd_1', productName: 'Çay', oldPriceCents: 5000, newPriceCents: 5500,
    }]);
  });
});
