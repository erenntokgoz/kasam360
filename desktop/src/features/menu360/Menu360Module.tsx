// Menü Yönetim Ana Modülü
// Katalog ve Fiyatlar sekmeleri, üst araç çubuğu ve donanımsal dokunsal düzen.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useEffect } from 'react';
import { Search, Plus, UtensilsCrossed, AlertTriangle } from 'lucide-react';
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
      {/* 1. Üst Araç Çubuğu (Toolbar) */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <UtensilsCrossed className="w-4 h-4 text-[var(--accent-blue)]" />
            <span className="text-[var(--text-primary)]">Menü</span>
            <span className="text-xs text-[var(--text-muted)] font-normal">
              {activeTab === 'KATALOG' ? 'Katalog Yönetimi' : 'Toplu Fiyat'}
            </span>
          </div>

          {/* Global Arama */}
          <div className="flex items-center gap-2 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 py-1.5 w-64 focus-within:border-[var(--accent-blue)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ürün, barkod veya kod ara…"
              className="bg-transparent border-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none w-full"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tükendi Çipi */}
          <button
            type="button"
            onClick={toggleFilterTukendi}
            className={`tactile-btn min-h-[38px] px-3 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
              filters.tukendi
                ? 'bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] shadow-[inset_0_0_0_1px_var(--accent-red-border)]'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[var(--accent-red)]" />
            <span>Tükendi: {tukendiCount}</span>
          </button>

          {/* Yeni Ürün Butonu */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('KATALOG');
              setDetailMode('new');
            }}
            className="tactile-btn min-h-[38px] px-4 rounded-md bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Yeni Ürün</span>
          </button>
        </div>
      </div>

      {/* 2. İç Sekmeler (Katalog / Fiyatlar) */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('KATALOG')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'KATALOG'
              ? 'border-[var(--accent-blue)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          <span>Katalog</span>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">({products.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('FIYATLAR')}
          className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'FIYATLAR'
              ? 'border-[var(--accent-blue)] text-[var(--text-primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          <span>Fiyatlar & Toplu Zam</span>
        </button>
      </div>

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
            className="text-xs font-bold hover:underline cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      {/* 3. Modül İçeriği */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {activeTab === 'KATALOG' ? <Menu360CatalogTab /> : <Menu360FiyatTab />}
      </div>
    </div>
  );
};
