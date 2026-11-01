// Menü Yönetim Ana Modülü
// Sekme seçimi CatalogTab'dadır; burada arama, tükendi süzgeci ve tam sayfa içerik durur.

import React, { useEffect } from 'react';
import { Search, Plus, AlertTriangle } from 'lucide-react';
import { useMenu360Store } from '../../stores/menu360Store';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
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
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden select-none">
      {activeTab === 'KATALOG' ? <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="relative w-80 max-w-full">
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ürün, barkod veya kod ara"
            aria-label="Menüde ara"
            className="!min-h-12 pl-10"
          />
          <Search className="w-5 h-5 text-[var(--text-muted)] absolute left-3 top-3.5 pointer-events-none" />
        </div>

        <div className="flex items-center gap-2">
          <Button variant={filters.tukendi ? 'danger' : 'secondary'} aria-pressed={filters.tukendi} onClick={toggleFilterTukendi}>
            Tükendi: <span className="tabular-nums">{tukendiCount}</span>
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setActiveTab('KATALOG');
              setDetailMode('new');
            }}
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Ürün</span>
          </Button>
        </div>
      </div> : null}

      {/* Hata Bildirimi */}
      {error && (
        <div role="alert" className="mx-5 mb-3 rounded-md bg-[var(--accent-red-soft)] border border-[var(--accent-red-border)] px-4 py-2 flex items-center justify-between text-sm font-semibold text-[var(--accent-red)]">
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

      <div className={`paper flex-1 flex min-h-0 overflow-hidden relative mx-5 mb-5 ${activeTab === 'KATALOG' ? '' : 'mt-3'}`}>
        {activeTab === 'KATALOG' ? <Menu360CatalogTab /> : <Menu360FiyatTab />}
      </div>
    </div>
  );
};
