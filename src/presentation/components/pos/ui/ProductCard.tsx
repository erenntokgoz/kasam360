import { POSProduct } from '../../../types';
import { MoneyDisplay } from '../../common/MoneyDisplay';

interface ProductCardProps {
  product: POSProduct;
  onClick: (product: POSProduct) => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const isOutOfStock = !product.inStock || (product.stockQuantity !== undefined && product.stockQuantity <= 0);

  return (
    <button
      onClick={() => onClick(product)}
      disabled={isOutOfStock}
      className={`relative flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-4 transition-all hover:bg-slate-700 active:scale-95 ${
        isOutOfStock ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <div className="mb-2 text-center text-sm font-semibold text-slate-200 line-clamp-2">
        {product.name}
      </div>
      <div className="text-lg font-bold text-emerald-400">
        <MoneyDisplay amountInCents={product.price} />
      </div>
      {isOutOfStock && (
        <div className="absolute top-2 right-2 rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-500">
          TÜKENDİ
        </div>
      )}
    </button>
  );
}
