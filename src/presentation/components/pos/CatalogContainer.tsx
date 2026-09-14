import { useState, useEffect, useMemo } from 'react';
import { useCartStore } from '../../store/useCartStore';
import { CatalogPanel } from './ui/CatalogPanel';
import { ModifierModal } from './ui/ModifierModal';
import { POSProduct, ModifierGroup, ModifierOption } from '../../types';
import { TauriPOSRepository } from '../../../data/ipc/TauriPOSRepository';

export function CatalogContainer() {
  const { 
    categories, 
    products, 
    activeCategory, 
    setActiveCategory, 
    searchQuery,
    setSearchQuery,
    addItem, 
    fetchCategories, 
    fetchCatalog,
    posRepository,
  } = useCartStore();
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const [selectedProduct, setSelectedProduct] = useState<POSProduct | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [isModifierModalOpen, setIsModifierModalOpen] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchCatalog();
  }, [fetchCategories, fetchCatalog]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(products.length / itemsPerPage));
  
  const currentProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return products.slice(start, start + itemsPerPage);
  }, [products, currentPage]);

  const handleProductClick = async (product: POSProduct) => {
    try {
      const repo = posRepository || TauriPOSRepository.getInstance();
      const groups = await repo.getProductModifiers(product.id);

      if (groups && groups.length > 0) {
        setModifierGroups(groups);
        setSelectedProduct(product);
        setIsModifierModalOpen(true);
      } else {
        addItem(product);
      }
    } catch (e) {
      console.error('Failed to fetch modifiers:', e);
      // Fallback to normal add if fetch fails
      addItem(product);
    }
  };

  const handleAddToCartWithModifiers = (modifiers: ModifierOption[], note?: string) => {
    if (selectedProduct) {
      addItem(selectedProduct, 1, modifiers, note);
    }
    setIsModifierModalOpen(false);
    setSelectedProduct(null);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <CatalogPanel
        categories={categories}
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        products={currentProducts}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        onProductClick={handleProductClick}
      />
      {isModifierModalOpen && selectedProduct && (
        <ModifierModal
          product={selectedProduct}
          groups={modifierGroups}
          onClose={() => setIsModifierModalOpen(false)}
          onAddToCart={handleAddToCartWithModifiers}
        />
      )}
    </div>
  );
}
