/**
 * CatalogContainer — Apple HIG Menü Kataloğu Akıllı Kapsayıcısı (Smart Container)
 *
 * Zustand useCartStore ve repository katmanını bağlar; ürünleri, arama durumunu,
 * sayfalama mantığını ve opsiyon/modifer modalını yönetir.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
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
    scanBarcode,
    posRepository,
  } = useCartStore();
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const [selectedProduct, setSelectedProduct] = useState<POSProduct | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [isModifierModalOpen, setIsModifierModalOpen] = useState(false);

  // Yerel arama durumu ve zamanlama referansları
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeystrokeTimeRef = useRef<number>(0);
  const lastLengthRef = useRef<number>(0);

  // Dışarıdan store arama sorgusu sıfırlandığında yerel durumu güncelle
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  // Zamanlayıcı temizleme
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Barkod okuyucu (<80ms veya toplu karakter girişi) ve el ile yazma (200ms debounce) ayrımı
  const handleSearchChange = (query: string) => {
    setLocalSearchQuery(query);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Arama temizlendiyse anında yansıt
    if (!query.trim()) {
      lastLengthRef.current = 0;
      setSearchQuery('');
      return;
    }

    const now = Date.now();
    const interval = now - lastKeystrokeTimeRef.current;
    lastKeystrokeTimeRef.current = now;

    const lengthDiff = query.length - lastLengthRef.current;
    lastLengthRef.current = query.length;

    // Barkod okuyucu tespiti: Çok hızlı tuş vuruşu (<80ms) veya anlık toplu giriş (>2 karakter birden)
    const isBarcodeScan = (interval > 0 && interval < 80) || lengthDiff > 2;

    if (isBarcodeScan) {
      // Barkod okuyucu akışında ara karakterlerde gereksiz IPC yarışını önlemek için 40ms sessizlik bekle
      debounceTimerRef.current = setTimeout(async () => {
        const trimmed = query.trim();
        // Tam barkod formatında (8-14 haneli sayısal) ise doğrudan eklemeyi dene
        if (/^\d{8,14}$/.test(trimmed)) {
          const matched = await scanBarcode(trimmed);
          if (matched) {
            setLocalSearchQuery('');
            setSearchQuery('');
            return;
          }
        }
        setSearchQuery(query);
      }, 40);
    } else {
      // Normal klavye yazımında 200ms debounce uygula
      debounceTimerRef.current = setTimeout(() => {
        setSearchQuery(query);
      }, 200);
    }
  };

  // Barkod okuyucu veya klavye Enter tuşu ile doğrudan ürün ekleme
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const trimmed = localSearchQuery.trim();
      if (!trimmed) return;

      // 1. Önce doğrudan barkod tarama fonksiyonunu çalıştır
      const matched = await scanBarcode(trimmed);
      if (matched) {
        setLocalSearchQuery('');
        setSearchQuery('');
        return;
      }

      // 2. Barkod ile birebir eşleşmediyse ama aramada tek bir ürün filtrelendiyse sepete ekle
      if (products.length === 1) {
        await handleProductClick(products[0]);
        setLocalSearchQuery('');
        setSearchQuery('');
      } else {
        setSearchQuery(trimmed);
      }
    }
  };

  // İlk yüklemede kategorileri ve ürün kataloğunu çek
  useEffect(() => {
    fetchCategories();
    fetchCatalog();
  }, [fetchCategories, fetchCatalog]);

  // Kategori veya arama sorgusu değiştiğinde ilk sayfaya dön
  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(products.length / itemsPerPage));
  
  // Geçerli sayfada gösterilecek ürünlerin hesaplanması
  const currentProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return products.slice(start, start + itemsPerPage);
  }, [products, currentPage]);

  // Ürüne tıklandığında: Modifier/opsiyon varsa modalı aç, yoksa doğrudan sepete ekle
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
      console.error('Opsiyonlar getirilemedi:', e);
      // Hata durumunda doğrudan sepete eklemeye geri dön
      addItem(product);
    }
  };

  // Opsiyon ve not ile sepete ekleme
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
        searchQuery={localSearchQuery}
        onSearchChange={handleSearchChange}
        onSearchKeyDown={handleSearchKeyDown}
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
