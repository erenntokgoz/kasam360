import React, { useMemo } from 'react';
import { Search } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMoney } from '../../lib/formatMoney';
import { matchesProduct } from '../../lib/searchText';
import { Button } from '../../ui/Button';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import type { Product } from '../../types/pos';

export interface ProductCatalogProps {
  onBindTableClick: () => void;
}

export const ProductCatalog: React.FC<ProductCatalogProps> = ({ onBindTableClick }) => {
  const {
    activeTableId,
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
    openWalkinOrder,
    activeTariffName,
  } = usePosStore();

  const setActiveModule = useUIStore((state) => state.setActiveModule);

  const query = searchQuery.trim();

  // Tükenen ürün listeden düşmez: garson neden seçemediğini görmelidir.
  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      if (query) return matchesProduct(query, prod.name, prod.barcode);
      return selectedCategoryId === 'cat_all' || prod.categoryId === selectedCategoryId;
    });
  }, [products, selectedCategoryId, query]);

  const handleProductClick = async (product: Product) => {
    const groups = await loadModifierGroups(product.id);
    if (groups === null) return;
    if (groups.length > 0) {
      openModifierModal({ ...product, modifierGroups: groups });
    } else {
      addItemToTicket(product);
    }
  };

  if (!activeTableId && !isWalkin) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md">
          <h2 className="auth-title !text-5xl">Önce masa seçin.</h2>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="primary" size="lg" onClick={() => setActiveModule('FLOOR')}>
              Salonu Aç
            </Button>
            <Button variant="secondary" size="lg" onClick={() => void openWalkinOrder()}>
              Tezgah Satışı
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      <Bar
        label="Adisyon"
        actions={
          <label className="bar-search">
            <Search className="w-4 h-4 shrink-0" />
            <input type="search" aria-label="Ürün ara" placeholder="Ürün ara" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </label>
        }
      >
        <span className="bar-label">{activeTableName}</span>
        {isWalkin ? <BarAction onClick={onBindTableClick}>Masaya Bağla</BarAction> : null}
        {activeTariffName ? <span className="bar-label !font-semibold !text-[var(--text-secondary)]">{activeTariffName}</span> : null}
      </Bar>

      <Bar label="Kategoriler" plain>
        {categories.map((cat) => (
          <BarTab key={cat.id} active={selectedCategoryId === cat.id} onClick={() => setSelectedCategoryId(cat.id)}>
            {cat.name}
          </BarTab>
        ))}
      </Bar>

      {/* Ürün Kartları Izgarası */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,150px),1fr))] gap-3 content-start">
        {filteredProducts.map((prod) => {
          const soldOut = !prod.isAvailable;
          return (
            <button
              key={prod.id}
              type="button"
              disabled={soldOut}
              onClick={() => void handleProductClick(prod)}
              className={`work-surface rounded-2xl border border-[var(--border)] p-4 min-h-[124px] flex flex-col justify-between text-left shadow-sm transition-transform duration-75 ${
                soldOut ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer active:translate-y-[1px]'
              }`}
            >
              <span className="text-lg font-bold leading-snug line-clamp-2 text-[var(--text-primary)]">{prod.name}</span>
              {soldOut ? (
                <span className="text-sm font-bold text-[var(--accent-red)]">Tükendi</span>
              ) : (
                <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(prod.unitPriceCents)}</span>
              )}
            </button>
          );
        })}
        {filteredProducts.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[var(--text-secondary)]">
            {query ? 'Aramayla eşleşen ürün yok.' : 'Bu kategoride ürün yok.'}
          </p>
        ) : null}
      </div>
    </div>
  );
};
