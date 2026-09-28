/**
 * ProductGridPanel — Apple HIG ve Spatial Glass Ürün Izgarası
 *
 * Ürün kartlarını duyarlı (responsive) ızgarada listeler ve sayfalama
 * kontrollerini havada süzülen cam kapsül içinde sunar.
 */

import { ChevronLeft, ChevronRight, PackageOpen } from 'lucide-react';
import { POSProduct } from '../../../types';
import { ProductCard } from './ProductCard';

export interface ProductGridPanelProps {
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
    <div className="flex h-full flex-col dark:bg-[#16171b] bg-transparent">
      {/* ── Ürün Izgarası ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {products.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border dark:border-white/10 border-black/10 dark:bg-white/[0.03] bg-black/[0.03] backdrop-blur-md">
              <PackageOpen size={24} className="dark:text-zinc-500 text-zinc-400" />
            </div>
            <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500">Ürün Bulunamadı</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3.5">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onClick={onProductClick} />
            ))}
          </div>
        )}
      </div>

      {/* ── Sayfalama Kapsülü (Havada Süzülen Apple Cam Kapsül) ────────── */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center border-t dark:border-white/10 border-black/10 dark:bg-black/20 bg-white/60 backdrop-blur-xl px-4 py-3">
          <div className="flex items-center gap-3 dark:bg-white/[0.06] bg-white/80 border dark:border-white/10 border-black/10 rounded-full px-3 py-1 shadow-lg backdrop-blur-2xl">
            <button
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Önceki Sayfa"
              className="flex items-center justify-center h-8 w-8 rounded-full dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-black hover:dark:bg-white/10 hover:bg-black/10 disabled:opacity-20 disabled:pointer-events-none transition-all touch-manipulation active:scale-90 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="font-mono text-xs font-semibold dark:text-zinc-300 text-zinc-700 px-2 select-none">
              Sayfa {currentPage} / {totalPages}
            </div>
            <button
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Sonraki Sayfa"
              className="flex items-center justify-center h-8 w-8 rounded-full dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-black hover:dark:bg-white/10 hover:bg-black/10 disabled:opacity-20 disabled:pointer-events-none transition-all touch-manipulation active:scale-90 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
