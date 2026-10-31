import React, { useMemo } from 'react';
import { ArrowLeft, Search, Layers } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import type { Product } from '../../types/pos';

export interface ProductCatalogProps {
  onBindTableClick: () => void;
}

export const ProductCatalog: React.FC<ProductCatalogProps> = ({ onBindTableClick }) => {
  const {
    activeTableName,
    isWalkin,
    categories,
    products,
    selectedCategoryId,
    searchQuery,
    setSelectedCategoryId,
    setSearchQuery,
    addItemToTicket,
    openModifierModal,
    loadModifierGroups,
    activeTariffName,
  } = usePosStore();

  const { setActiveModule } = useUIStore();

  // Kategori ve arama filtreleme
  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      const matchCat =
        selectedCategoryId === 'cat_all' || prod.categoryId === selectedCategoryId;
      const matchQuery =
        !searchQuery || prod.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery && prod.isAvailable;
    });
  }, [products, selectedCategoryId, searchQuery]);

  const handleProductClick = async (product: Product) => {
    const groups = await loadModifierGroups(product.id);
    if (groups === null) return;
    if (groups.length > 0) {
      openModifierModal({ ...product, modifierGroups: groups });
    } else {
      addItemToTicket(product);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      {/* Üst Bar */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActiveModule('FLOOR')}
            className="!min-h-12 !px-3 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Salona Dön</span>
          </Button>

          <div className="px-3.5 h-[38px] rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center gap-2.5">
            <span className="text-xs font-bold text-[var(--text-primary)]">{activeTableName}</span>
            {isWalkin ? (
              <button
                type="button"
                onClick={onBindTableClick}
                className="text-xs font-semibold text-[var(--accent-amber)] hover:underline cursor-pointer"
              >
                Masaya Bağla
              </button>
            ) : null}
          </div>
          {activeTariffName ? (
            <span className="px-3 h-[38px] rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-soft)] flex items-center text-xs font-bold text-[var(--accent-amber)]">
              Tarife: {activeTariffName}
            </span>
          ) : null}
        </div>

        {/* Arama Kutusu */}
        <div className="relative w-full sm:w-64">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ürün veya barkod ara..."
            className="!min-h-12 pl-9 text-xs"
          />
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Kategori Hapları Şeridi */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {categories.map((cat) => {
          const isSelected = selectedCategoryId === cat.id;
          return (
            <Button
              key={cat.id}
              variant={isSelected ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedCategoryId(cat.id)}
              className="!min-h-12 whitespace-nowrap text-xs"
            >
              {cat.name}
            </Button>
          );
        })}
      </div>

      {/* Ürün Kartları Izgarası */}
      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 content-start">
        {filteredProducts.map((prod) => (
          <div
            key={prod.id}
            onClick={() => void handleProductClick(prod)}
            className="bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent-amber-border)] rounded-xl p-3.5 min-h-[96px] flex flex-col justify-between cursor-pointer active:translate-y-[1px] transition-all duration-75 shadow-sm group"
          >
            <div>
              <span className="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-amber)] block line-clamp-2">
                {prod.name}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mt-0.5">
                {prod.station}
              </span>
            </div>

            <div className="flex items-baseline justify-between mt-2 pt-1 border-t border-[var(--border)]">
              <span className="text-xs font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(prod.unitPriceCents)}
              </span>
              <span className="text-[10px] text-[var(--accent-amber)] font-semibold flex items-center gap-0.5">
                <Layers className="w-3 h-3" />
                <span>+ Ekle</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
