import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';
import { useMenuStore } from '../../stores/menuStore';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { Input } from '../../ui/Input';
import { errorText } from '../../lib/cariInput';
import { formatNumber } from '../../lib/numberText';
import { filterMenuProducts, isOnSale, menuProducts } from '../../lib/productState';
import { CatalogBulkBar } from './CatalogBulkBar';
import { MenuCategoryTree } from './MenuCategoryTree';
import { MenuProductCard } from './MenuProductCard';
import { MenuDetailPanel } from './MenuDetailPanel';
import { ProductActions } from './ProductActions';

export const MenuCatalogTab: React.FC = () => {
  const {
    products, categories, setSelectedProductId, detailMode, setDetailMode,
    searchQuery, setSearchQuery, filters, setCategoryFilter,
    toggleFilterTukendi, toggleFilterSatista, toggleFilterSatisDisi,
  } = useMenuStore();
  const canEditCatalog = useAuthStore((state) => state.user?.role === 'OWNER');
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isSorting, setIsSorting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const savingOrder = useRef(false);
  const extras = useMenuExtrasStore((state) => state.products);
  const parents = useMenuExtrasStore((state) => state.parents);
  const loadExtras = useMenuExtrasStore((state) => state.load);
  const saveOrder = useMenuExtrasStore((state) => state.saveOrder);

  useEffect(() => {
    void loadExtras().catch((caught: unknown) => setOrderError(errorText(caught)));
  }, [loadExtras, products.length]);

  const orderedProducts = useMemo(() => menuProducts(products)
    .sort((a, b) => (extras[a.id]?.displayOrder ?? 0) - (extras[b.id]?.displayOrder ?? 0)), [products, extras]);

  const filteredProducts = filterMenuProducts(orderedProducts, searchQuery, filters, parents);
  const scopedProducts = filterMenuProducts(orderedProducts, searchQuery, {
    ...filters, tukendi: false, satista: false, satisDisi: false,
  }, parents);
  const activeFilter = filters.tukendi ? toggleFilterTukendi
    : filters.satista ? toggleFilterSatista
    : filters.satisDisi ? toggleFilterSatisDisi : null;
  const statuses = [
    { label: 'Tümü', count: scopedProducts.length, active: activeFilter === null, action: () => activeFilter?.() },
    { label: 'Satışta', count: scopedProducts.filter(isOnSale).length, active: filters.satista, action: toggleFilterSatista },
    { label: 'Tükendi', count: scopedProducts.filter((product) => product.is86).length, active: filters.tukendi, action: toggleFilterTukendi },
    { label: 'Satış Dışı', count: scopedProducts.filter((product) => !product.isActive).length, active: filters.satisDisi, action: toggleFilterSatisDisi },
  ];

  const move = async (index: number, step: number) => {
    const target = index + step;
    if (target < 0 || target >= filteredProducts.length || savingOrder.current) return;
    savingOrder.current = true;
    setOrderError(null);
    const currentId = filteredProducts[index].id;
    const targetId = filteredProducts[target].id;
    // Filtreye girmeyen ürünler kendi yerlerini korur.
    const ids = orderedProducts.map(({ id }) => id === currentId ? targetId : id === targetId ? currentId : id);
    try {
      await saveOrder(ids);
    } catch (caught) {
      setOrderError(errorText(caught));
    } finally {
      savingOrder.current = false;
    }
  };

  if (detailMode === 'new') {
    return <MenuDetailPanel onBack={() => void setSelectedProductId(null)} />;
  }

  const openedProduct = orderedProducts.find((product) => product.id === openedProductId);
  const visibleSelection = filteredProducts.filter((product) => selected.includes(product.id)).map((product) => product.id);
  const category = categories.find((item) => item.id === filters.categoryId);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      <ErrorToast message={orderError} />
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold mr-2">Ürünler</h2>
          <div className="relative min-w-28 flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
            <Input type="search" aria-label="Ürün ara" className="!pl-9"
              value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSelected([]); }} />
          </div>
          {canEditCatalog ? (
            <Button type="button" variant="primary" onClick={() => {
              setDetailMode('new');
            }}>Yeni Ürün</Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto" role="group" aria-label="Ürün Durumu">
          {statuses.map(({ label, count, active, action }) => (
            <Button key={label} type="button" size="sm" className="shrink-0" aria-pressed={active}
              variant={active ? 'selected' : 'secondary'} onClick={() => { action(); setSelected([]); }}>
              {label} <span className="tabular-nums text-xs">{formatNumber(count)}</span>
            </Button>
          ))}
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden lg:flex-row">
        <MenuCategoryTree onSelect={(id) => { setCategoryFilter(id); setSelected([]); }} />
        <section className="min-h-0 min-w-0 flex flex-1 flex-col">
          <div className="shrink-0 flex flex-wrap justify-between items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-semibold">
              {category?.name ?? 'Tüm Kategoriler'} <span className="text-[var(--text-secondary)] tabular-nums">· {formatNumber(filteredProducts.length)} ürün</span>
            </span>
            {filteredProducts.length > 0 ? (
              <CatalogBulkBar selected={visibleSelection} onClear={() => setSelected([])}
                isSorting={isSorting} onToggleSort={() => setIsSorting((value) => !value)} canEditCatalog={canEditCatalog} />
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {filteredProducts.length === 0 ? (
              <p className="p-3 text-sm text-[var(--text-secondary)]">
                {orderedProducts.length === 0 ? 'Henüz ürün yok.' : 'Eşleşen ürün yok.'}
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3">
                {filteredProducts.map((product, index) => (
                  <li key={product.id}>
                    <MenuProductCard product={product} station={extras[product.id]?.station ?? null}
                      isChecked={selected.includes(product.id)}
                      onCheck={(isOn) => setSelected((list) => isOn ? [...list, product.id] : list.filter((id) => id !== product.id))}
                      onMove={isSorting ? (step) => void move(index, step) : undefined}
                      isSelected={openedProductId === product.id}
                      onSelect={setOpenedProductId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      {openedProduct ? <ProductActions key={openedProduct.id} product={openedProduct} onClose={() => setOpenedProductId(null)} /> : null}
    </div>
  );
};
