// Ürün sayfası: ürün kartına tıklanınca tam ekran açılır.
// Fiyat burada düzenlenir; seçenek ve reçete aynı sayfada yan kâğıttadır.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Trash2, Check, AlertCircle } from 'lucide-react';
import { useMenuStore, parseMoneyToCents } from '../../stores/menuStore';
import { MenuDetailTemel } from './MenuDetailTemel';
import { MenuDetailModifiye } from './MenuDetailModifiye';
import { MenuRecipeTab } from './MenuRecipeTab';
import { useAuthStore } from '../../stores/authStore';
import { ProductMenuSettings } from './ProductMenuSettings';
import { useMenuExtrasStore } from '../../stores/menuExtrasStore';

interface MenuDetailPanelProps {
  onOpenModifierModal?: () => void;
}

export const MenuDetailPanel: React.FC<MenuDetailPanelProps> = ({
  onOpenModifierModal,
}) => {
  const {
    products,
    categories,
    modifierGroups,
    productModifierGroupIds,
    modifierGroupsLoading,
    selectedProductId,
    detailMode,
    setSelectedProductId,
    saveProduct,
    deleteProduct,
    toggleProductActive,
    toggleProduct86,
    deleteModifierGroup,
    deleteModifierOption,
    addModifierOption,
    setProductModifierGroupIds,
    productRecipe,
    createRecipe,
    deactivateRecipe,
    busy,
  } = useMenuStore();

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const copySource = useMenuExtrasStore((state) => state.copySource);
  const setCopySource = useMenuExtrasStore((state) => state.setCopySource);
  const setDetailMode = useMenuStore((state) => state.setDetailMode);
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MASTER');

  // Form state
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [stockUnit, setStockUnit] = useState('adet');
  const [taxRateBp, setTaxRateBp] = useState(1000);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const initializedDraft = useRef<string | null>(null);

  // Formu seçili ürüne göre doldur
  useEffect(() => {
    const draftKey = detailMode === 'new' ? `new:${copySource ?? ''}` : selectedProductId;
    if (!draftKey) {
      initializedDraft.current = null;
      return;
    }
    // Alt akışta kategori/ürün eklenmesi açık formdaki kullanıcının girdilerini silemez.
    if (initializedDraft.current === draftKey) return;
    const source = products.find((p) => p.id === copySource);
    if (detailMode === 'new' && copySource && !source) return;
    if (detailMode !== 'new' && !selectedProduct) return;
    initializedDraft.current = draftKey;
    if (detailMode === 'new') {
      setName(source ? `${source.name} (kopya)` : '');
      setCategoryId(source?.categoryId ?? (categories.length > 0 ? categories[0].id : ''));
      setPriceInput(source ? (source.priceCents / 100).toFixed(2).replace('.', ',') : '');
      setBarcode('');
      setDescription(source?.description ?? '');
      setStockUnit(source?.stockUnit ?? 'adet');
      setTaxRateBp(source?.taxRateBp ?? 1000);
      setFormError(null);
    } else if (selectedProduct) {
      setName(selectedProduct.name);
      setCategoryId(selectedProduct.categoryId);
      setPriceInput((selectedProduct.priceCents / 100).toFixed(2).replace('.', ','));
      setBarcode(selectedProduct.barcode || '');
      setDescription(selectedProduct.description || '');
      setStockUnit(selectedProduct.stockUnit || 'adet');
      setTaxRateBp(selectedProduct.taxRateBp ?? 1000);
      setFormError(null);
    }
  }, [selectedProductId, detailMode, selectedProduct, categories, copySource, products]);

  if (!selectedProduct && detailMode !== 'new') return null;

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Ürün adı zorunludur.');
      return;
    }
    if (!categoryId) {
      setFormError('Kategori seçimi zorunludur.');
      return;
    }

    try {
      const priceCents = parseMoneyToCents(priceInput);
      const success = await saveProduct({
        name: name.trim(),
        categoryId,
        priceCents,
        barcode: barcode.trim() || undefined,
        description: description.trim() || undefined,
        stockUnit,
        taxRateBp,
      });

      if (!success) {
        setFormError('Ürün kaydedilirken hata oluştu.');
      }
    } catch {
      setFormError('Geçerli bir fiyat tutarı giriniz (örn: 45,00).');
    }
  };

  // Hammadde menüden çıkar ve satışa kapanır; stok ekranında satış ürününe geri çevrilir.
  const convertToRaw = async () => {
    if (await saveProduct({ isRaw: true })) setSelectedProductId(null);
  };

  const handleDelete = async () => {
    if (!selectedProductId) return;
    const ok = await deleteProduct(selectedProductId);
    if (ok) {
      setShowDeleteConfirm(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col min-w-0 overflow-hidden select-none">
      <div className="shrink-0 flex items-center gap-3 px-4 min-h-14 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => {
            setCopySource(null);
            setSelectedProductId(null);
          }}
          className="min-h-12 px-3 flex items-center gap-2 font-bold cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
          Ürünler
        </button>
        <h2 className="print-title text-lg font-bold truncate flex-1">{detailMode === 'new' ? 'Yeni Ürün' : selectedProduct?.name}</h2>
        {selectedProduct && detailMode !== 'new' ? (
          <button
            type="button"
            onClick={() => {
              setCopySource(selectedProduct.id);
              setDetailMode('new');
            }}
            className="min-h-12 px-3 font-bold cursor-pointer"
          >
            Kopyala
          </button>
        ) : null}
        {selectedProduct && detailMode !== 'new' ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={busy}
            className="min-h-12 px-3 flex items-center gap-2 font-bold text-[var(--accent-red)] cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Sil
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 grid gap-4 lg:grid-cols-2 content-start">
        <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-4 lg:row-span-2">
          <h3 className="print-title font-bold">Ürün</h3>
        {formError && (
          <div className="p-2.5 rounded-lg bg-[var(--accent-red-soft)] border border-[var(--accent-red-border)] text-[var(--accent-red)] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

          <MenuDetailTemel
            name={name}
            setName={setName}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            priceInput={priceInput}
            setPriceInput={setPriceInput}
            barcode={barcode}
            setBarcode={setBarcode}
            description={description}
            setDescription={setDescription}
            stockUnit={stockUnit}
            setStockUnit={setStockUnit}
              taxRateBp={taxRateBp}
              setTaxRateBp={setTaxRateBp}
            categories={categories}
            selectedProduct={selectedProduct}
            detailMode={detailMode}
            toggleProductActive={toggleProductActive}
            toggleProduct86={toggleProduct86}
            onConvertToRaw={isOwner ? () => void convertToRaw() : undefined}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="tactile-btn w-full min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{detailMode === 'new' ? 'Ürünü Oluştur' : 'Kaydet'}</span>
          </button>
        </div>

        {detailMode !== 'new' && selectedProduct ? (
          <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h3 className="print-title font-bold">Menü Ayarları</h3>
            <ProductMenuSettings product={selectedProduct} />
          </div>
        ) : null}

        {/* Seçenek ve reçete yönetimi sahibindir; müdüre açılan bölüm yetki hatası veriyordu. */}
        {isOwner ? (
        <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h3 className="print-title font-bold">Seçenekler</h3>

        {detailMode === 'new' && (
          <p className="text-xs text-[var(--text-secondary)]">Önce ürünü kaydedin.</p>
        )}
        {detailMode !== 'new' && selectedProductId && (
          <MenuDetailModifiye
            modifierGroups={modifierGroups}
            assignedGroupIds={productModifierGroupIds}
            loading={modifierGroupsLoading}
            onToggleGroup={(groupId, checked) => {
              const nextIds = checked
                ? [...productModifierGroupIds, groupId]
                : productModifierGroupIds.filter((id) => id !== groupId);
              void setProductModifierGroupIds(selectedProductId, nextIds);
            }}
            onOpenModifierModal={onOpenModifierModal}
            deleteModifierGroup={deleteModifierGroup}
            deleteModifierOption={deleteModifierOption}
            addModifierOption={addModifierOption}
          />
        )}

        </div>

        ) : null}

        {isOwner ? (
        <div className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h3 className="print-title font-bold">Reçete</h3>
        {detailMode === 'new' ? <p className="text-sm">Ürün oluşturulunca reçete burada açılır.</p> : null}
        {detailMode !== 'new' && selectedProduct && (
          <MenuRecipeTab
            product={selectedProduct}
            products={products}
            cost={productRecipe}
            busy={busy}
            createRecipe={createRecipe}
            deactivateRecipe={deactivateRecipe}
          />
        )}
        </div>
        ) : null}
      </div>

      {/* Silme Onay Modalı */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-80 paper border border-[var(--border)] rounded-xl p-4 space-y-4 shadow-2xl">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Ürünü Sil?</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              &quot;{selectedProduct?.name}&quot; menüden silinecek. Bu işlem denetim defterine kaydedilir.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--accent-red)] hover:bg-[var(--danger-hover)] text-sm font-bold text-white cursor-pointer"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
