import { capitalizeRecordName } from '../../lib/recordName';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
// Menü Ürün Detay Paneli - Temel Bilgiler Alt Sekmesi
// Ürün adı, kategori, KDV dahil kuruş satış fiyatı, barkod, açıklama ve durum anahtarları.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React from 'react';
import { NumberInput } from '../../ui/NumberInput';
import type { CategoryDto } from '../../types/menu';

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
  onNewCategory: () => void;
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
  onNewCategory,
}) => {
  return (
    <div className="space-y-3.5">
      <div>
        <label htmlFor="new-product-name" className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Ürün Adı
        </label>
        <input
          id="new-product-name" type="text" required
          value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Kategori
        </label>
        <select required
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
        <button type="button" className="min-h-12 font-bold cursor-pointer" onClick={onNewCategory}>Yeni Kategori Oluştur</button>
      </div>

      <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Satış Fiyatı
        </label>
        <div className="relative">
          <NumberInput aria-label="Satış Fiyatı" pinpadTitle="Satış Fiyatı" value={priceInput} onValueChange={setPriceInput} />
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
          {['adet', 'g', 'kg', 'ml', 'l'].map((unit) => <option key={unit} value={unit}>{stockUnitLabel(unit)}</option>)}
        </select>
      </label>

      <div>
        <label htmlFor="menu-product-barcode" className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Barkod / SKU (İsteğe Bağlı)
        </label>
        <input
          id="menu-product-barcode"
          type="text"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm tabular-nums text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="menu-product-description" className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
          Açıklama (İsteğe Bağlı)
        </label>
        <textarea
          id="menu-product-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none resize-none"
        />
      </div>

      <p className="text-xs text-[var(--text-secondary)]">
        İstasyon: {categories.find((category) => category.id === categoryId)?.defaultStation || 'Tanımlı değil'}
      </p>

    </div>
  );
};
