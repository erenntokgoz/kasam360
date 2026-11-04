// Menü Ürün Detay Paneli - Temel Bilgiler Alt Sekmesi
// Ürün adı, kategori, KDV dahil kuruş satış fiyatı, barkod, açıklama ve durum anahtarları.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import type { CategoryDto, ProductDto } from '../../types/menu';
import { MenuCategoryModal } from './MenuCategoryModal';
import { useAuthStore } from '../../stores/authStore';

interface MenuDetailTemelProps {
  name: string;
  setName: (val: string) => void;
  categoryId: string;
  setCategoryId: (val: string) => void;
  priceInput: string;
  setPriceInput: (val: string) => void;
  barcode: string;
  setBarcode: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  stockUnit: string;
  setStockUnit: (val: string) => void;
  taxRateBp: number;
  setTaxRateBp: (val: number) => void;
  categories: CategoryDto[];
  selectedProduct?: ProductDto;
  detailMode: 'view' | 'new';
  toggleProductActive: (id: string) => Promise<boolean>;
  toggleProduct86: (id: string, is86: boolean) => Promise<boolean>;
  onConvertToRaw?: () => void;
}

export const MenuDetailTemel: React.FC<MenuDetailTemelProps> = ({
  name,
  setName,
  categoryId,
  setCategoryId,
  priceInput,
  setPriceInput,
  barcode,
  setBarcode,
  description,
  setDescription,
  stockUnit,
  setStockUnit,
  taxRateBp,
  setTaxRateBp,
  categories,
  selectedProduct,
  detailMode,
  toggleProductActive,
  toggleProduct86,
  onConvertToRaw,
}) => {
  const [categoryOpen, setCategoryOpen] = useState(false);
  const canCreateCategory = useAuthStore((state) => state.user?.role === 'OWNER');
  return (
    <div className="space-y-3.5">
      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Ürün Adı
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Örn: Espresso Double"
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Kategori
        </label>
        <select
          aria-label="Kategori"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none cursor-pointer"
        >
          <option value="">Kategori seçin</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {canCreateCategory && <button type="button" className="min-h-12 font-bold cursor-pointer" onClick={() => setCategoryOpen(true)}>Yeni kategori oluştur</button>}
        <MenuCategoryModal isOpen={categoryOpen} onClose={() => setCategoryOpen(false)} onCreated={(category) => setCategoryId(category.id)} />
      </div>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Satış Fiyatı
        </label>
        <div className="relative">
          <NumberInput aria-label="Satış Fiyatı" pinpadTitle="Satış Fiyatı" value={priceInput} onValueChange={setPriceInput} placeholder="0,00" />
        </div>
      </div>

      <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase space-y-1">
        <span>KDV Oranı</span>
        <select aria-label="KDV Oranı" value={taxRateBp} onChange={(e) => setTaxRateBp(Number(e.target.value))} className="w-full min-h-12 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 text-sm text-[var(--text-primary)]">
          {[0, 100, 1000, 2000].map((rate) => <option key={rate} value={rate}>%{rate / 100}</option>)}
        </select>
      </label>

      <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase space-y-1">
        <span>Stok Birimi</span>
        <select value={stockUnit} onChange={(e) => setStockUnit(e.target.value)} className="w-full min-h-12 bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md px-3 text-sm text-[var(--text-primary)]">
          {stockUnit === 'belirsiz' && <option value="belirsiz">Belirsiz — düzeltin</option>}
          {['adet', 'g', 'kg', 'ml', 'l'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </label>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Barkod / SKU (İsteğe Bağlı)
        </label>
        <input
          type="text"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Açıklama (İsteğe Bağlı)
        </label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ürün içeriği veya menü açıklaması…"
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none resize-none"
        />
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        İstasyon: {categories.find((category) => category.id === categoryId)?.defaultStation || 'Tanımlı değil'}
      </p>

      {selectedProduct && detailMode !== 'new' && (
        <div className="pt-2 space-y-2 border-t border-[var(--border)]">
          {/* Satış dışı kalıcı karardır; tükendi gün içinde stok dönünce kalkar. */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Satış Dışı</span>
            <button
              type="button"
              role="switch"
              aria-checked={!selectedProduct.isActive}
              aria-label="Satış Dışı"
              onClick={() => toggleProductActive(selectedProduct.id)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer after:content-[''] after:absolute after:inset-x-0 after:-inset-y-3.5 ${
                !selectedProduct.isActive ? 'bg-[var(--text-muted)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                  !selectedProduct.isActive ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Tükendi</span>
            <button
              type="button"
              role="switch"
              aria-checked={selectedProduct.is86}
              aria-label="Tükendi"
              onClick={() => toggleProduct86(selectedProduct.id, !selectedProduct.is86)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer after:content-[''] after:absolute after:inset-x-0 after:-inset-y-3.5 ${
                selectedProduct.is86 ? 'bg-[var(--accent-red)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                  selectedProduct.is86 ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {onConvertToRaw ? (
            <button type="button" className="tactile-btn w-full min-h-12 rounded-lg text-sm font-bold" onClick={onConvertToRaw}>
              Hammaddeye Çevir
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
