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

  // Filtreleme mantığı
  const filteredProducts = products.filter((p) => {
    // 1. Arama filtresi
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      const matchSku = p.sku?.toLowerCase().includes(q);
      if (!matchName && !matchBarcode && !matchSku) return false;
    }

    // 2. Kategori filtresi
    // Üst kategori seçilince alt kategorilerin ürünleri de görünür.
    if (filters.categoryId && p.categoryId !== filters.categoryId && parents[p.categoryId] !== filters.categoryId) {
      return false;
    }

    // 3. Tükendi filtresi
    if (filters.tukendi && !p.is86) {
      return false;
    }

    // 4. Satışta filtresi
    if (filters.satista && (!p.isActive || p.is86)) {
      return false;
    }

    return true;
  }).sort((a, b) => (extras[a.id]?.displayOrder ?? 0) - (extras[b.id]?.displayOrder ?? 0));

  const move = (index: number, step: number) => {
    const ids = filteredProducts.map((p) => p.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Görünmeyen ürünler sıranın sonunda kalır: filtre başka ürünü kaydırmaz.
    const rest = products.map((p) => p.id).filter((id) => !ids.includes(id));
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
        {products.length > 0 ? (
          <CatalogBulkBar
            selected={selected}
            onClear={() => setSelected([])}
            isSorting={isSorting}
            onToggleSort={() => setIsSorting((value) => !value)}
          />
        ) : null}
        {filteredProducts.length === 0 ? (
          <div className="h-full flex flex-col items-start gap-3 p-4">
            <p className="text-sm font-semibold">{products.length === 0 ? 'Henüz ürün yok.' : 'Bu filtrede ürün yok.'}</p>
            {products.length === 0 ? (
              <button type="button" className="tactile-btn min-h-12 px-4 rounded-lg font-bold" onClick={() => setDetailMode('new')}>
                Yeni Ürün
              </button>
            ) : null}
          </div>
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
