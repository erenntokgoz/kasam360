// Menü Katalog Sekmesi
// Sol kategori ağacı, merkez ürün kartları ızgarası, sağ detay paneli.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect, useState } from 'react';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { CatalogBulkBar } from './CatalogBulkBar';
import { useMenuStore } from '../../stores/menuStore';
import { MenuCategoryTree } from './MenuCategoryTree';
import { MenuProductCard } from './MenuProductCard';
import { MenuDetailPanel } from './MenuDetailPanel';
import { MenuCategoryModal } from './MenuCategoryModal';
import { MenuModifierModal } from './MenuModifierModal';
import { filterMenuProducts, menuProducts } from '../../lib/productState';
import { Button } from '../../ui/Button';

export const MenuCatalogTab: React.FC = () => {
  const {
    products,
    selectedProductId,
    setSelectedProductId,
    detailMode,
    setDetailMode,
    searchQuery,
    filters,
  } = useMenuStore();

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isModifierModalOpen, setIsModifierModalOpen] = useState(false);
  const [isPageOpen, setIsPageOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [isSorting, setIsSorting] = useState(false);
  const extras = useMenuExtrasStore((state) => state.products);
  const parents = useMenuExtrasStore((state) => state.parents);
  const loadExtras = useMenuExtrasStore((state) => state.load);
  const saveOrder = useMenuExtrasStore((state) => state.saveOrder);

  useEffect(() => {
    void loadExtras().catch(() => undefined);
  }, [loadExtras, products.length]);
  // Katalog açılırken ilk ürün seçili gelir; sayfa yalnız karta tıklanınca açılır.
  const showPage = detailMode === 'new' || (isPageOpen && selectedProductId !== null);

  const saleProducts = menuProducts(products);
  const filteredProducts = filterMenuProducts(products, searchQuery, filters, parents)
    .sort((a, b) => (extras[a.id]?.displayOrder ?? 0) - (extras[b.id]?.displayOrder ?? 0));

  const move = (index: number, step: number) => {
    const ids = filteredProducts.map((p) => p.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Görünmeyen ürünler sıranın sonunda kalır: filtre başka ürünü kaydırmaz.
    const rest = saleProducts.map((p) => p.id).filter((id) => !ids.includes(id));
    void saveOrder([...ids, ...rest]);
  };

  if (showPage) {
    return (
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <MenuDetailPanel onOpenModifierModal={() => setIsModifierModalOpen(true)} />
        <MenuModifierModal isOpen={isModifierModalOpen} onClose={() => setIsModifierModalOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative bg-[var(--bg-canvas)]">
      {/* 1. Sol Kategori Ağacı */}
      <MenuCategoryTree
        onOpenNewCategoryModal={() => setIsCategoryModalOpen(true)}
      />

      {/* 2. Merkez Ürün Izgarası */}
      <div className="flex-1 overflow-y-auto p-4 bg-[var(--bg-canvas)] space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {saleProducts.length > 0 ? (
            <CatalogBulkBar
              selected={selected}
              onClear={() => setSelected([])}
              isSorting={isSorting}
              onToggleSort={() => setIsSorting((value) => !value)}
            />
          ) : <span />}
          <Button variant="primary" className="min-h-12" onClick={() => setDetailMode('new')}>Yeni Ürün</Button>
        </div>
        {filteredProducts.length === 0 ? (
          <p className="p-4 text-sm font-semibold">{saleProducts.length === 0 ? 'Henüz ürün yok.' : 'Bu filtrede ürün yok.'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {filteredProducts.map((prod, index) => (
              <MenuProductCard
                key={prod.id}
                product={prod}
                station={extras[prod.id]?.station ?? null}
                isChecked={selected.includes(prod.id)}
                onCheck={(isOn) => setSelected((list) => (isOn ? [...list, prod.id] : list.filter((id) => id !== prod.id)))}
                onMove={isSorting ? (step) => move(index, step) : undefined}
                isSelected={selectedProductId === prod.id}
                onSelect={(id) => {
                  setSelectedProductId(id);
                  setIsPageOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modallar */}
      <MenuCategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
      />
      <MenuModifierModal
        isOpen={isModifierModalOpen}
        onClose={() => setIsModifierModalOpen(false)}
      />
    </div>
  );
};
