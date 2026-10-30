// Menü Kategori Ağacı ve Hızlı Filtreler
// Sol navigasyon paneli: kategoriler, ürün sayıları, silme işlemi ve durum filtreleri.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useMenu360Store } from '../../stores/menu360Store';
import type { CategoryDto } from '../../types/menu360';

interface Menu360CategoryTreeProps {
  onOpenNewCategoryModal: () => void;
}

export const Menu360CategoryTree: React.FC<Menu360CategoryTreeProps> = ({
  onOpenNewCategoryModal,
}) => {
  const {
    categories,
    products,
    filters,
    setCategoryFilter,
    toggleFilterTukendi,
    toggleFilterSatista,
    deleteCategory,
    busy,
  } = useMenu360Store();

  const [deletingCat, setDeletingCat] = useState<CategoryDto | null>(null);

  const totalCount = products.length;
  const tukendiCount = products.filter((p) => p.is86).length;
  const satistaCount = products.filter((p) => p.isActive && !p.is86).length;

  return (
    <div className="w-56 bg-[var(--bg-panel)] border-r border-[var(--border)] p-3 flex flex-col justify-between select-none shrink-0">
      <div className="space-y-4">
        {/* Kategoriler Bölümü */}
        <div>
          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-1">
            Kategoriler
          </div>
          <div className="mt-1 space-y-0.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                filters.categoryId === null
                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border)] font-bold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span>Tüm Ürünler</span>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">{totalCount}</span>
            </button>

            {categories.map((cat) => {
              const count = products.filter((p) => p.categoryId === cat.id).length;
              const isSelected = filters.categoryId === cat.id;
              return (
                <div
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`group w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_var(--border)] font-bold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="truncate flex-1 text-left">{cat.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">{count}</span>
                    <button
                      type="button"
                      disabled={count > 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingCat(cat);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-red)] rounded cursor-pointer transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                      title={count > 0 ? 'Önce ürünleri taşıyın' : 'Kategoriyi sil'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hızlı Filtreler */}
        <div>
          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider px-2 py-1">
            Hızlı Filtre
          </div>
          <div className="mt-1 space-y-1">
            <button
              type="button"
              onClick={toggleFilterTukendi}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                filters.tukendi
                  ? 'bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)] font-bold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent-red)]" />
                Tükendi
              </span>
              <span className="text-[11px] font-mono tabular-nums">{tukendiCount}</span>
            </button>

            <button
              type="button"
              onClick={toggleFilterSatista}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                filters.satista
                  ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald)] border border-[var(--accent-emerald-border)] font-bold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent-emerald)]" />
                Satışta
              </span>
              <span className="text-[11px] font-mono tabular-nums">{satistaCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Kategori Ekle Butonu */}
      <div className="pt-2 border-t border-[var(--border)]">
        <button
          type="button"
          onClick={onOpenNewCategoryModal}
          className="tactile-btn w-full min-h-[44px] px-3 py-2 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-xs font-bold border border-[var(--border)] flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Kategori Ekle</span>
        </button>
      </div>

      {/* Kategori Silme Onay Modalı */}
      {deletingCat && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-80 bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Kategoriyi Sil?</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Boş &quot;{deletingCat.name}&quot; kategorisi silinecektir.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingCat(null)}
                className="tactile-btn flex-1 min-h-[40px] rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await deleteCategory(deletingCat.id);
                  setDeletingCat(null);
                }}
                className="tactile-btn flex-1 min-h-[40px] rounded-lg bg-[var(--accent-red)] hover:bg-[var(--danger-hover)] text-xs font-bold text-white cursor-pointer disabled:opacity-50"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
