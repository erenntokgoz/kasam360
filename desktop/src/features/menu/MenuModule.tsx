import React, { useEffect } from 'react';
import { Bar } from '../../ui/Bar';
import { ErrorToast } from '../../ui/ErrorToast';
import { useMenuStore } from '../../stores/menuStore';
import { MenuCatalogTab } from './MenuCatalogTab';

/** Bölüm sekmeleri sabit kalır, ürün araçları yalnız katalog açıkken görünür. */
export const MenuModule: React.FC<{ tabs: React.ReactNode }> = ({ tabs }) => {
  const loadCatalog = useMenuStore((state) => state.loadCatalog);
  const error = useMenuStore((state) => state.error);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <Bar label="Menü ve Stok" plain>{tabs}</Bar>
      <ErrorToast message={error} />
      <MenuCatalogTab />
    </div>
  );
};
