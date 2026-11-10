'use client';

import { formatMenuPrice } from '@/lib/menuView';
import type { MenuProduct } from '@/lib/qrMenu';

// Görseli olmayan ürün: boş görsel kutusu yerine ince ayraçlı liste satırı (ad ve kısa açıklama solda, fiyat sağda).
export function ProductRow({ product, currency, onOpen }: {
  product: MenuProduct; currency: string; onOpen: (product: MenuProduct, trigger: HTMLElement) => void;
}) {
  const soldOut = !product.inStock;
  return (
    <button type="button" className="m-row" data-sold-out={soldOut} onClick={(event) => onOpen(product, event.currentTarget)}>
      <span className="m-row-text">
        <span className="m-row-name">{product.name}</span>
        {product.description && <span className="m-row-desc">{product.description}</span>}
      </span>
      <span className="m-row-end">
        <span className="m-price k-num">{formatMenuPrice(product.priceCents, currency)}</span>
        {soldOut && <span className="m-badge">Tükendi</span>}
      </span>
    </button>
  );
}
