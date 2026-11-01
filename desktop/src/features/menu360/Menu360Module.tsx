// Menü Yönetim Ana Modülü
// Katalog ve Fiyatlar sekmeleri, üst araç çubuğu ve donanımsal dokunsal düzen.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { formatNumber } from '../../lib/numberText';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { useMenu360Store } from '../../stores/menu360Store';
import { Menu360CatalogTab } from './Menu360CatalogTab';
import { Menu360FiyatTab } from './Menu360FiyatTab';

export const Menu360Module: React.FC = () => {
  const {
    products,
    activeTab,
    setActiveTab,
    setDetailMode,
    searchQuery,
    setSearchQuery,
    filters,
    toggleFilterTukendi,
    loadCatalog,
    error,
    clearError,
  } = useMenu360Store();

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const tukendiCount = products.filter((p) => p.is86).length;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <Bar
        label="Menü"
        plain
        actions={
          <>
            <label className="bar-search">
              <Search className="w-4 h-4 shrink-0" />
              <input
                type="text"
                aria-label="Ürün ara"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ürün ara"
              />
            </label>
            <BarAction aria-pressed={filters.tukendi} onClick={toggleFilterTukendi}>
              Tükendi <span className="tabular-nums">{formatNumber(tukendiCount)}</span>
            </BarAction>
            <BarAction
              tone="primary"
              onClick={() => {
                setActiveTab('KATALOG');
                setDetailMode('new');
              }}
            >
              Yeni Ürün
            </BarAction>
          </>
        }
      >
        <BarTab active={activeTab === 'KATALOG'} onClick={() => setActiveTab('KATALOG')}>Katalog</BarTab>
        <BarTab active={activeTab === 'FIYATLAR'} onClick={() => setActiveTab('FIYATLAR')}>Fiyatlar</BarTab>
      </Bar>

      {/* Hata Bildirimi */}
      {error && (
        <div className="bg-[var(--accent-red-soft)] border-b border-[var(--accent-red-border)] px-4 py-2 flex items-center justify-between text-xs text-[var(--accent-red)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--accent-red)]" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="min-h-12 px-3 font-bold hover:underline cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      {/* 3. Modül İçeriği */}
      <div className="paper !rounded-none flex-1 flex min-h-0 overflow-hidden relative">
        {activeTab === 'KATALOG' ? <Menu360CatalogTab /> : <Menu360FiyatTab />}
      </div>
    </div>
  );
};
