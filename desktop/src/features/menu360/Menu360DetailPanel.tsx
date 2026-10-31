// Menü Sağ Detay Paneli (Drawer)
// Temel bilgiler, modifiyeler, fiyatlandırma ve reçete dökümü.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState, useEffect } from 'react';
import { X, Trash2, Check, AlertCircle } from 'lucide-react';
import { useMenu360Store, parseMoneyToCents } from '../../stores/menu360Store';
import { useFeatureStore } from '../../stores/featureStore';
import { formatMoney } from '../../lib/formatMoney';
import { Menu360DetailTemel } from './Menu360DetailTemel';
import { Menu360DetailModifiye } from './Menu360DetailModifiye';
import { Menu360RecipeTab } from './Menu360RecipeTab';

interface Menu360DetailPanelProps {
  onOpenModifierModal?: () => void;
}

export const Menu360DetailPanel: React.FC<Menu360DetailPanelProps> = ({
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
    detailTab,
    setDetailTab,
    setSelectedProductId,
    saveProduct,
    deleteProduct,
    toggleProductActive,
    toggleProduct86,
    deleteModifierGroup,
    addModifierOption,
    setProductModifierGroupIds,
    productRecipe,
    createRecipe,
    deactivateRecipe,
    busy,
  } = useMenu360Store();
  const isEnabled = useFeatureStore((state) => state.isEnabled);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

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

  // Formu seçili ürüne göre doldur
  useEffect(() => {
    if (detailMode === 'new') {
      setName('');
      setCategoryId(categories.length > 0 ? categories[0].id : '');
      setPriceInput('');
      setBarcode('');
      setDescription('');
      setStockUnit('adet');
      setTaxRateBp(1000);
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
  }, [selectedProductId, detailMode, selectedProduct, categories]);

  if (!selectedProduct && detailMode !== 'new') {
    return (
      <div className="w-84 bg-[var(--bg-panel)] border-l border-[var(--border)] p-6 flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none shrink-0">
        <p className="text-sm">Düzenlemek için bir ürün seçin veya yeni ürün oluşturun.</p>
      </div>
    );
  }

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

  const handleDelete = async () => {
    if (!selectedProductId) return;
    const ok = await deleteProduct(selectedProductId);
    if (ok) {
      setShowDeleteConfirm(false);
    }
  };

  return (
    <aside className="w-84 bg-[var(--bg-panel)] border-l border-[var(--border)] flex flex-col justify-between select-none shrink-0 overflow-hidden">
      {/* Üst Başlık & Sekmeler */}
      <div className="flex flex-col border-b border-[var(--border)]">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-panel)] border-b border-[var(--border)]">
          <h2 className="print-title text-sm font-bold text-[var(--text-primary)] truncate">
            {detailMode === 'new' ? '+ Yeni Ürün' : selectedProduct?.name}
          </h2>
          <button
            type="button"
            onClick={() => setSelectedProductId(null)}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Alt Sekme: Temel, Modifiye, Fiyat, Reçete */}
        <div className="flex bg-[var(--bg-panel)]">
          {(['temel', 'modifiye', 'fiyat', 'recete'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setDetailTab(tab)}
              className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors capitalize cursor-pointer ${
                detailTab === tab
                  ? 'border-[var(--accent-blue)] text-[var(--text-primary)] bg-[var(--bg-card)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab === 'recete' ? 'Reçete' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Form Alanı */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {formError && (
          <div className="p-2.5 rounded-lg bg-[var(--accent-red-soft)] border border-[var(--accent-red-border)] text-[var(--accent-red)] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* 1. TEMEL SEKME */}
        {detailTab === 'temel' && (
          <Menu360DetailTemel
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
          />
        )}

        {/* 2. MODİFİYE SEKME */}
        {detailTab === 'modifiye' && detailMode === 'new' && (
          <p className="text-xs text-[var(--text-secondary)]">Seçenek gruplarını bağlamak için önce ürünü kaydedin.</p>
        )}
        {detailTab === 'modifiye' && detailMode !== 'new' && selectedProductId && (
          <Menu360DetailModifiye
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
            addModifierOption={addModifierOption}
          />
        )}

        {/* 3. FİYAT SEKME */}
        {detailTab === 'fiyat' && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
              <span className="text-[11px] font-bold text-[var(--text-muted)] block mb-1">GÜNCEL FİYAT</span>
              <div className="text-xl font-bold font-mono text-[var(--text-primary)]">
                {selectedProduct ? formatMoney(selectedProduct.priceCents) : '—'}
              </div>
              <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                Tabak satış fiyatı
              </span>
            </div>

            {isEnabled('feat_dynamic_pricing') && <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-1">
              <span className="text-xs font-bold text-[var(--text-secondary)]">Fiyat Listeleri</span>
              <p className="text-xs text-[var(--text-muted)]">
                Bu ürün varsayılan satış listesine bağlıdır. Ek tarife tanımları Fiyatlar sekmesindedir.
              </p>
            </div>}
          </div>
        )}

        {/* 4. REÇETE SEKME */}
        {detailTab === 'recete' && detailMode === 'new' && (
          <p className="text-xs text-[var(--text-secondary)]">Reçete oluşturmak için önce ürünü kaydedin.</p>
        )}
        {detailTab === 'recete' && detailMode !== 'new' && selectedProduct && (
          <Menu360RecipeTab
            product={selectedProduct}
            products={products}
            cost={productRecipe}
            busy={busy}
            createRecipe={createRecipe}
            deactivateRecipe={deactivateRecipe}
          />
        )}
      </div>

      {/* Alt Butonlar */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--bg-panel)] flex items-center gap-2">
        {detailTab === 'temel' && <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          <span>{detailMode === 'new' ? 'Ürünü Oluştur' : 'Kaydet'}</span>
        </button>}

        {selectedProduct && detailMode !== 'new' && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={busy}
            className="tactile-btn min-h-12 px-3.5 rounded-lg bg-transparent border border-[var(--accent-red-border)] hover:bg-[var(--accent-red-soft)] text-[var(--accent-red)] text-xs font-bold flex items-center justify-center cursor-pointer disabled:opacity-50"
            aria-label="Sil"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Silme Onay Modalı */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-80 paper border border-[var(--border)] rounded-xl p-5 space-y-4 shadow-2xl">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Ürünü Sil?</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              &quot;{selectedProduct?.name}&quot; menüden silinecek. Bu işlem denetim defterine kaydedilir.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--accent-red)] hover:bg-[var(--danger-hover)] text-xs font-bold text-white cursor-pointer"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
