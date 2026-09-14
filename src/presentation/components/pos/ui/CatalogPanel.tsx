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
  currentPage,
  totalPages,
  onPageChange,
  onProductClick,
}: CatalogPanelProps) {
  return (
    <div className="flex h-full w-full flex-col bg-slate-950">
      {/* Search Header Bar */}
      <div className="border-b border-slate-800 bg-slate-900/60 p-3">
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Ürün adı veya barkod ile ara..."
            className="h-10 w-full rounded-xl border border-slate-700 bg-slate-800/80 pl-10 pr-10 text-sm text-slate-100 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 rounded-md p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Body: Categories + Product Grid */}
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
