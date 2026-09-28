/**
 * ProductCard — Apple HIG ve Spatial Glass Ürün Kartı Bileşeni
 *
 * Dokunulduğunda yaylanan (active:scale-[0.97]), yumuşak rounded-2xl köşeli,
 * 1px hairline border ve Apple tipografisine sahip lüks ürün kartı.
 */

import { POSProduct } from '../../../types';
import { MoneyDisplay } from '../../common/MoneyDisplay';

interface ProductCardProps {
  product: POSProduct;
  onClick: (product: POSProduct) => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  // Stok tükenme kontrolü
  const isOutOfStock = !product.inStock || (product.stockQuantity !== undefined && product.stockQuantity <= 0);

  return (
    <button
      type="button"
      onClick={() => onClick(product)}
      disabled={isOutOfStock}
      aria-label={isOutOfStock ? `${product.name} tükendi` : `${product.name}, ${(product.price / 100).toFixed(2)} TL`}
      className={`group relative flex min-h-[116px] flex-col items-center justify-between rounded-2xl border p-4 transition-all duration-150 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] backdrop-blur-2xl ${
        isOutOfStock
          ? 'dark:bg-white/[0.02] bg-black/[0.02] dark:border-white/5 border-black/5 opacity-40 cursor-not-allowed pointer-events-none'
          : 'dark:bg-white/[0.05] bg-white/80 hover:dark:bg-white/[0.08] hover:bg-white active:scale-[0.97] dark:border-white/10 border-black/10 hover:dark:border-white/20 hover:border-black/20 shadow-sm dark:shadow-[0_4px_16px_rgba(0,0,0,0.25)] hover:shadow-md cursor-pointer'
      }`}
    >
      {/* Ürün İsmi — Apple Minimal Tipografi */}
      <div className="w-full text-center text-sm font-medium dark:text-zinc-200 dark:group-hover:text-white text-zinc-800 group-hover:text-zinc-950 line-clamp-2 leading-snug tracking-[-0.01em] my-auto">
        {product.name}
      </div>

      {/* Fiyat Göstergesi — Apple System Green (#34C759) */}
      <div className="mt-2.5 text-sm font-bold text-[#34C759] font-mono tracking-tight">
        <MoneyDisplay amountInCents={product.price} />
      </div>

      {/* Stok Durum Rozeti */}
      {isOutOfStock && (
        <div className="absolute top-2.5 right-2.5 rounded-full bg-[#FF453A]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#FF453A] border border-[#FF453A]/30 backdrop-blur-sm">
          TÜKENDİ
        </div>
      )}
    </button>
  );
}
