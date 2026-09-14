import { POSProduct } from '../../../types';
import { ProductCard } from './ProductCard';

interface ProductGridPanelProps {
  products: POSProduct[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onProductClick: (product: POSProduct) => void;
}

export function ProductGridPanel({
  products,
  currentPage,
  totalPages,
  onPageChange,
  onProductClick,
}: ProductGridPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onClick={onProductClick} />
          ))}
        </div>
      </div>
      
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center border-t border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center space-x-6">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded bg-slate-800 px-6 py-3 font-mono text-lg font-bold text-slate-300 disabled:opacity-30 transition-opacity hover:bg-slate-700"
            >
              &lt;
            </button>
            <div className="font-mono text-lg text-slate-300">
              {currentPage} / {totalPages}
            </div>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="rounded bg-slate-800 px-6 py-3 font-mono text-lg font-bold text-slate-300 disabled:opacity-30 transition-opacity hover:bg-slate-700"
            >
              &gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
