/**
 * CategorySidebar — Apple HIG ve Spatial Glass Kategori Menüsü
 *
 * Havada süzülen şık cam kapsüllerle (spatial glass pills) kategorileri
 * listeler. Seçili öğe Apple System Blue (#007AFF) rengiyle parlar.
 */

import { LayoutGrid, Star, Layers } from 'lucide-react';
import { POSCategory } from '../../../types';

export interface CategorySidebarProps {
  categories: POSCategory[];
  activeCategory: string;
  onSelect: (categoryId: string) => void;
}

export function CategorySidebar({ categories, activeCategory, onSelect }: CategorySidebarProps) {
  // Apple HIG ve Spatial Glass: Light modda saydam açık cam, dark modda koyu şeffaf cam
  return (
    <div className="flex h-full w-52 lg:w-60 shrink-0 flex-col gap-2 p-3 overflow-y-auto dark:bg-[#16171b]/95 bg-white/40 border-r dark:border-white/10 border-black/10 backdrop-blur-2xl">
      {/* ── Tüm Ürünler Kapsülü ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onSelect('all')}
        className={`group relative flex items-center justify-between px-4 py-3 min-h-[46px] rounded-2xl border text-sm font-medium transition-all duration-200 touch-manipulation active:scale-[0.97] cursor-pointer ${
          activeCategory === 'all'
            ? 'bg-[#007AFF] text-white border-white/20 shadow-[0_4px_18px_rgba(0,122,255,0.35)] font-semibold'
            : 'dark:bg-white/[0.04] bg-white/70 dark:text-zinc-400 text-zinc-700 dark:border-white/10 border-black/10 hover:dark:bg-white/[0.08] hover:bg-white hover:dark:text-zinc-100 hover:text-zinc-950'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <LayoutGrid size={16} className={activeCategory === 'all' ? 'text-white' : 'dark:text-zinc-400 text-zinc-500'} />
          <span className="truncate">Tüm Ürünler</span>
        </div>
        {activeCategory === 'all' && (
          <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
        )}
      </button>

      {/* ── Favoriler Kapsülü ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onSelect('favorites')}
        className={`group relative flex items-center justify-between px-4 py-3 min-h-[46px] rounded-2xl border text-sm font-medium transition-all duration-200 touch-manipulation active:scale-[0.97] cursor-pointer ${
          activeCategory === 'favorites'
            ? 'bg-[#007AFF] text-white border-white/20 shadow-[0_4px_18px_rgba(0,122,255,0.35)] font-semibold'
            : 'dark:bg-white/[0.04] bg-white/70 dark:text-zinc-400 text-zinc-700 dark:border-white/10 border-black/10 hover:dark:bg-white/[0.08] hover:bg-white hover:dark:text-zinc-100 hover:text-zinc-950'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Star size={16} className={activeCategory === 'favorites' ? 'text-amber-300 fill-amber-300' : 'text-amber-500'} />
          <span className="truncate">★ Favoriler</span>
        </div>
        {activeCategory === 'favorites' && (
          <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
        )}
      </button>

      {/* ── Dinamik Kategori Kapsülleri ──────────────────────────────── */}
      {categories.map((category) => {
        const isActive = activeCategory === category.id;
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            className={`group relative flex items-center justify-between px-4 py-3 min-h-[46px] rounded-2xl border text-sm font-medium transition-all duration-200 touch-manipulation active:scale-[0.97] cursor-pointer ${
              isActive
                ? 'bg-[#007AFF] text-white border-white/20 shadow-[0_4px_18px_rgba(0,122,255,0.35)] font-semibold'
                : 'dark:bg-white/[0.04] bg-white/70 dark:text-zinc-400 text-zinc-700 dark:border-white/10 border-black/10 hover:dark:bg-white/[0.08] hover:bg-white hover:dark:text-zinc-100 hover:text-zinc-950'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Layers size={14} className={isActive ? 'text-white' : 'dark:text-zinc-500 text-zinc-400'} />
              <span className="truncate">{category.name}</span>
            </div>
            {isActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}
