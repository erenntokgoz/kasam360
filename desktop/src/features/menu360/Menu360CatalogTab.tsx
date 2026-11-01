// Menü Katalog Sekmesi
// Sol kategori ağacı, merkez ürün kartları ızgarası, sağ detay paneli.

import React, { useState } from 'react';
import { useMenu360Store } from '../../stores/menu360Store';
import { Menu360CategoryTree } from './Menu360CategoryTree';
import { Menu360ProductCard } from './Menu360ProductCard';
import { Menu360DetailPanel } from './Menu360DetailPanel';
import { Menu360CategoryModal } from './Menu360CategoryModal';
import { Menu360ModifierModal } from './Menu360ModifierModal';

export const Menu360CatalogTab: React.FC = () => {
  const {
    products,
    selectedProductId,
    setSelectedProductId,
    searchQuery,
    filters,
  } = useMenu360Store();

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isModifierModalOpen, setIsModifierModalOpen] = useState(false);

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
    if (filters.categoryId && p.categoryId !== filters.categoryId) {
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
  });

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative bg-[var(--bg-canvas)]">
      {/* 1. Sol Kategori Ağacı */}
      <Menu360CategoryTree
        onOpenNewCategoryModal={() => setIsCategoryModalOpen(true)}
      />

      {/* 2. Merkez Ürün Izgarası */}
      <div className="flex-1 overflow-y-auto p-4 bg-[var(--bg-canvas)]">
        {filteredProducts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[var(--text-muted)]">
            <p className="text-sm font-semibold text-[var(--text-secondary)]">
              Aranan kriterlere uygun ürün bulunamadı.
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Filtreleri temizleyebilir veya yeni ürün ekleyebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((prod) => (
              <Menu360ProductCard
                key={prod.id}
                product={prod}
                isSelected={selectedProductId === prod.id}
                onSelect={setSelectedProductId}
              />
            ))}
          </div>
        )}
      </div>

      {/* 3. Sağ Detay Paneli */}
      <Menu360DetailPanel
        onOpenModifierModal={() => setIsModifierModalOpen(true)}
      />

      {/* Modallar */}
      <Menu360CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
      />
      <Menu360ModifierModal
        isOpen={isModifierModalOpen}
        onClose={() => setIsModifierModalOpen(false)}
      />
    </div>
  );
};
