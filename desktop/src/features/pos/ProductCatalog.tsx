import React, { useMemo } from 'react';
import { Search } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMoney } from '../../lib/formatMoney';
import { matchesProduct } from '../../lib/searchText';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
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

  const { setActiveModule } = useUIStore();

  // Tükenen ürün listeden düşmez: garson neden seçemediğini görmelidir.
  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      if (searchQuery) return matchesProduct(searchQuery, prod.name, prod.barcode);
      return selectedCategoryId === 'cat_all' || prod.categoryId === selectedCategoryId;
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

  if (!activeTableId && !isWalkin) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md">
          <h2 className="auth-title !text-5xl">Önce masa seçin.</h2>
          <p className="mt-3 text-lg text-[var(--text-secondary)]">
            Sipariş bir masaya ya da tezgaha yazılır.
          </p>
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
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden select-none">
      <div className="px-5 pt-4 flex flex-wrap items-center gap-3 shrink-0">
        <h2 className="text-2xl font-extrabold tracking-tight">{activeTableName}</h2>
        {isWalkin ? (
          <Button variant="secondary" size="sm" onClick={onBindTableClick}>
            Masaya Bağla
          </Button>
        ) : null}
        {activeTariffName ? (
          <span className="text-sm font-bold text-[var(--accent-amber)]">Tarife: {activeTariffName}</span>
        ) : null}
        <div className="relative ml-auto w-full sm:w-72">
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ürün adı veya barkod"
            aria-label="Ürün ara"
            className="!min-h-12 pl-10"
          />
          <Search className="w-5 h-5 text-[var(--text-muted)] absolute left-3 top-3.5 pointer-events-none" />
        </div>
      </div>

      <div className="px-5 pt-2 flex items-center gap-6 overflow-x-auto shrink-0 border-b-2 border-[var(--border)]">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="desk-tab text-lg"
            aria-pressed={!searchQuery && selectedCategoryId === cat.id}
            onClick={() => {
              setSearchQuery('');
              setSelectedCategoryId(cat.id);
            }}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 grid grid-cols-1 xl:grid-cols-2 gap-x-8 content-start">
        {filteredProducts.map((prod) => {
          const soldOut = !prod.isAvailable;
          return (
            <button
              key={prod.id}
              type="button"
              disabled={soldOut}
              onClick={() => void handleProductClick(prod)}
              className={`min-h-[66px] flex items-center justify-between gap-4 text-left border-b border-[var(--border)] ${
                soldOut ? 'cursor-not-allowed text-[var(--text-muted)]' : 'cursor-pointer hover:bg-[var(--bg-panel)] active:bg-[var(--bg-card)]'
              }`}
            >
              <span className="text-xl font-semibold truncate">{prod.name}</span>
              {soldOut ? (
                <span className="text-sm font-bold text-[var(--accent-red)] shrink-0">Tükendi</span>
              ) : (
                <span className="text-xl font-bold tabular-nums shrink-0">{formatMoney(prod.unitPriceCents)}</span>
              )}
            </button>
          );
        })}
        {filteredProducts.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[var(--text-secondary)]">
            {searchQuery ? 'Aramayla eşleşen ürün yok.' : 'Bu kategoride ürün yok.'}
          </p>
        ) : null}
      </div>
    </div>
  );
};
