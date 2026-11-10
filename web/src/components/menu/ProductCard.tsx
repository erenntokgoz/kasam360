'use client';

import { formatMenuPrice } from '@/lib/menuView';
import type { MenuProduct } from '@/lib/qrMenu';
import { ProductImage } from './ProductImage';

// Görselli ürün oranlı görsel taşır; görseli olmayan ürün boş kutu yerine yazı odaklı kompakt kart olur.
export function ProductCard({ product, currency, priority, onOpen }: {
  product: MenuProduct; currency: string; priority: boolean; onOpen: (product: MenuProduct, trigger: HTMLElement) => void;
}) {
  const soldOut = !product.inStock;
  return (
    <button
      type="button"
      className="m-card"
      data-has-image={product.image ? 'true' : 'false'}
      data-sold-out={soldOut}
      onClick={(event) => onOpen(product, event.currentTarget)}
    >
      {product.image && (
        <span className="m-card-media">
          <ProductImage src={product.image} alt="" priority={priority} />
        </span>
      )}
      <span className="m-card-body">
        <span className="m-card-name">{product.name}</span>
        {product.description && <span className="m-card-desc">{product.description}</span>}
        <span className="m-card-foot">
          <span className="m-price k-num">{formatMenuPrice(product.priceCents, currency)}</span>
          {soldOut && <span className="m-badge">Tükendi</span>}
        </span>
      </span>
    </button>
  );
}
