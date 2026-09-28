/**
 * CatalogPanel — Apple HIG ve Spatial Glass Menü Kataloğu Paneli
 *
 * Arama çubuğu, kategori kenar çubuğu ve ürün ızgarasını bir araya getiren
 * saf sunum (presenter) bileşeni.
 */

import { Search, X } from 'lucide-react';
import { POSCategory, POSProduct } from '../../../types';
import { CategorySidebar } from './CategorySidebar';
import { ProductGridPanel } from './ProductGridPanel';

export interface CatalogPanelProps {
  categories: POSCategory[];
  activeCategory: string;
  onSelectCategory: (categoryId: string) => void;
  products: POSProduct[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onProductClick: (product: POSProduct) => void;
}

export function CatalogPanel({
  categories,
  activeCategory,
  onSelectCategory,
  products,
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  currentPage,
  totalPages,
  onPageChange,
  onProductClick,
}: CatalogPanelProps) {
  return (
    <div className="flex h-full w-full flex-col dark:bg-[#16171b] bg-transparent">
      {/* ── Arama Başlık Çubuğu (Apple Spatial Glass Arama Alanı) ──────── */}
      <div className="border-b dark:border-white/10 border-black/10 dark:bg-black/20 bg-white/60 backdrop-blur-2xl px-5 py-3 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 h-4 w-4 dark:text-zinc-400 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Ürün adı veya barkod ile ara..."
            className="h-11 w-full rounded-2xl border dark:border-white/10 border-black/10 dark:bg-white/[0.05] bg-black/[0.04] hover:dark:bg-white/[0.08] hover:bg-black/[0.06] focus:dark:bg-white/[0.09] focus:bg-white pl-10 pr-10 text-sm dark:text-zinc-100 text-zinc-900 dark:placeholder-zinc-400 placeholder-zinc-500 focus:border-[#007AFF] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/25 transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Aramayı temizle"
              className="absolute right-3.5 flex h-6 w-6 items-center justify-center rounded-full dark:bg-white/10 bg-black/10 dark:text-zinc-400 text-zinc-600 dark:hover:text-white hover:text-black dark:hover:bg-white/20 hover:bg-black/20 transition-all cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Ana Gövde: Kategoriler ve Ürün Izgarası ───────────────────── */}
      <div className="flex flex-1 min-h-0">
        <div className="shrink-0">
          <CategorySidebar
            categories={categories}
            activeCategory={activeCategory}
            onSelect={onSelectCategory}
          />
        </div>
        <div className="flex-1 min-w-0">
          <ProductGridPanel
            products={products}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            onProductClick={onProductClick}
          />
        </div>
      </div>
    </div>
  );
}
