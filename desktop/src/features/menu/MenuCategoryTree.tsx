import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { useMenuStore } from '../../stores/menuStore';
import { formatNumber } from '../../lib/numberText';
import { menuProducts } from '../../lib/productState';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Modal } from '../../ui/Modal';
import { MenuCategoryModal } from './MenuCategoryModal';
import type { CategoryDto } from '../../types/menu';

export const MenuCategoryTree: React.FC<{ onSelect: (id: string | null) => void }> = ({ onSelect }) => {
  const { categories, products, filters, deleteCategory } = useMenuStore();
  const canEdit = useAuthStore((state) => state.user?.role === 'OWNER');
  const parents = useMenuExtrasStore((state) => state.parents);
  const loadExtras = useMenuExtrasStore((state) => state.load);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CategoryDto | 'NEW' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const detail = categories.find((category) => category.id === detailId);
  const selected = categories.find((category) => category.id === filters.categoryId);
  const saleProducts = menuProducts(products);
  const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
  const categoryIds = new Set(categories.map((category) => category.id));
  const ordered = sorted.filter((category) => !categoryIds.has(parents[category.id] ?? '')).flatMap((parent) => [
    parent, ...sorted.filter((category) => parents[category.id] === parent.id),
  ]);
  const countOf = (id: string) => saleProducts.filter((product) =>
    product.categoryId === id || parents[product.categoryId] === id).length;
  const hasProducts = detail ? saleProducts.some((product) => product.categoryId === detail.id) : false;

  return (
    <aside className="shrink-0 min-w-0 border-b border-[var(--border)] bg-[var(--bg-panel)] lg:w-56 lg:border-b-0 lg:border-r lg:flex lg:flex-col" aria-label="Ürün Kategorileri">
      <div className="flex gap-2 items-center px-3 py-2 lg:justify-between">
        <h3 className="hidden lg:block text-sm font-bold">Kategoriler</h3>
        <select aria-label="Kategori filtresi"
          className="lg:hidden min-w-0 min-h-12 flex-1 rounded-lg px-3 bg-[var(--bg-subtle)] border border-[var(--border)]"
          value={selected?.id ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
          <option value="">Tüm Kategoriler</option>
          {ordered.map((category) => (
            <option key={category.id} value={category.id}>{parents[category.id] ? '↳ ' : ''}{category.name}</option>
          ))}
        </select>
        {canEdit ? <Button type="button" size="sm" onClick={() => setDraft('NEW')}>Kategori Ekle</Button> : null}
      </div>
      {canEdit && selected ? (
        <div className="px-3 pb-2">
          <Button type="button" size="sm" className="w-full" onClick={() => setDetailId(selected.id)}>Kategori Detayı</Button>
        </div>
      ) : null}
      <ul className="hidden lg:block min-h-0 overflow-y-auto px-3 pb-3 space-y-1">
        <li>
          <Button type="button" size="sm" className="w-full !justify-between"
            aria-pressed={selected === undefined} variant={selected === undefined ? 'selected' : 'ghost'} onClick={() => onSelect(null)}>
            Tüm Kategoriler <span className="tabular-nums text-xs">{formatNumber(saleProducts.length)}</span>
          </Button>
        </li>
        {ordered.map((category) => (
          <li key={category.id} className={parents[category.id] ? 'pl-3' : undefined}>
            <Button type="button" size="sm" title={category.name} className="w-full !justify-between"
              aria-pressed={selected?.id === category.id} variant={selected?.id === category.id ? 'selected' : 'ghost'}
              onClick={() => onSelect(category.id)}>
              <span className="truncate">{category.name}</span>
              <span className="tabular-nums text-xs shrink-0">{formatNumber(countOf(category.id))}</span>
            </Button>
          </li>
        ))}
      </ul>
      <MenuCategoryModal isOpen={draft !== null} category={draft === 'NEW' ? null : draft}
        onCreated={(category) => { if (draft === 'NEW') onSelect(category.id); }}
        onClose={() => setDraft(null)} />
      {detail && draft === null && !deleting ? (
        <Modal cardFlow isOpen title={detail.name} maxWidth="sm" onClose={() => setDetailId(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-[var(--text-secondary)]">Ürün</dt><dd className="font-bold tabular-nums">{formatNumber(countOf(detail.id))}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">İstasyon</dt><dd className="font-bold">{detail.defaultStation || 'Tanımlı değil'}</dd></div>
          </dl>
          {hasProducts ? <p className="mt-3 text-sm text-[var(--text-secondary)]">Kategoriyi silmeden önce ürünlerini taşıyın.</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="danger" disabled={hasProducts} onClick={() => setDeleting(true)}>Sil</Button>
            <Button type="button" variant="primary" onClick={() => setDraft(detail)}>Düzenle</Button>
          </div>
        </Modal>
      ) : null}
      {detail && deleting ? (
        <ConfirmDialog cardFlow title={`${detail.name} silinsin mi?`}
          onClose={() => setDeleting(false)} onConfirm={async () => {
            if (!await deleteCategory(detail.id)) throw new Error(useMenuStore.getState().error ?? 'Kategori silinemedi.');
            setDetailId(null);
            await loadExtras();
          }} />
      ) : null}
    </aside>
  );
};
