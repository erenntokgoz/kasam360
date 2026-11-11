// Menü Fiyatlar Sekmesi
// Toplu zam yönetimi, fiyat önizleme tablosu ve alternatif fiyat listeleri.
// Açık ve koyu tema tam uyumlu, CSS tema değişkenleriyle desteklenir.

import React, { useState } from 'react';
import { Percent, DollarSign, Check, Trash2, Plus, ArrowRight } from 'lucide-react';
import { NumberInput } from '../../ui/NumberInput';
import { useMenuStore } from '../../stores/menuStore';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { parsePercentBp } from '../../lib/numberText';
import { useFeatureStore } from '../../stores/featureStore';

export const MenuFiyatTab: React.FC = () => {
  const { isEnabled } = useFeatureStore();
  const {
    categories,
    priceLists,
    bulkPreview,
    calculateBulkPreview,
    clearBulkPreview,
    applyBulkPrice,
    createPriceList,
    deletePriceList,
    busy,
  } = useMenuStore();

  const [updateType, setUpdateType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [valInput, setValInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [deletingPriceListId, setDeletingPriceListId] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  // Yeni Liste Modalı
  const [isNewListOpen, setIsNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  // Yüzde baz puan, tutar kuruş olarak okunur: hesaba kayan nokta girmez.
  const readValue = (): number | null => {
    const value = updateType === 'PERCENTAGE' ? parsePercentBp(valInput) : parseCents(valInput);
    return value !== null && value > 0 ? value : null;
  };

  const handlePreview = () => {
    setResultMsg(null);
    const valueNum = readValue();
    if (valueNum === null) return;

    calculateBulkPreview(
      updateType,
      valueNum,
      selectedCategory === 'ALL' ? undefined : selectedCategory
    );
  };

  const handleApply = async () => {
    setShowApplyConfirm(false);
    const valueNum = readValue();
    if (valueNum === null) return;

    const res = await applyBulkPrice({
      updateType,
      value: valueNum,
      categoryId: selectedCategory === 'ALL' ? undefined : selectedCategory,
    });

    if (res) {
      const changedCount = Array.isArray(res.changed) ? res.changed.length : res.changed;
      const skippedCount = Array.isArray(res.skipped) ? res.skipped.length : res.skipped;
      setResultMsg(
        `Fiyatlar güncellendi: ${changedCount} ürün değişti, ${skippedCount} ürün korundu.`
      );
    }
  };

  const handleCreatePriceList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    const ok = await createPriceList(newListName.trim(), newListDesc.trim() || undefined);
    if (ok) {
      setNewListName('');
      setNewListDesc('');
      setIsNewListOpen(false);
    }
  };

  const handleDeletePriceList = async () => {
    if (!deletingPriceListId) return;
    const ok = await deletePriceList(deletingPriceListId);
    if (ok) {
      setDeletingPriceListId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto p-4 gap-4 select-none bg-[var(--bg-canvas)]">
      {/* Sol Panel: Toplu Zam Yapıcı */}
      <div className="flex-1 flex flex-col paper border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 bg-[var(--bg-panel)] border-b border-[var(--border)]">
          <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">
            Toplu Fiyat Artışı
          </h2>
        </div>

        <div className="p-4 border-b border-[var(--border)] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. İşlem Tipi */}
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                İşlem Tipi
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => { setUpdateType('PERCENTAGE'); clearBulkPreview(); }}
                  className={`min-h-12 px-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-colors ${
                    updateType === 'PERCENTAGE'
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <Percent className="w-3.5 h-3.5" />
                  <span>% Oran</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setUpdateType('FIXED_AMOUNT'); clearBulkPreview(); }}
                  className={`min-h-12 px-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 border cursor-pointer transition-colors ${
                    updateType === 'FIXED_AMOUNT'
                      ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>TL Sabit</span>
                </button>
              </div>
            </div>

            {/* 2. Değer */}
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                {updateType === 'PERCENTAGE' ? 'Artış Oranı (%)' : 'Artış Tutarı (TL)'}
              </label>
              <NumberInput aria-label="Zam değeri" pinpad={updateType === 'FIXED_AMOUNT'} value={valInput} onValueChange={(text) => { setValInput(text); clearBulkPreview(); }} />
            </div>

            {/* 3. Kapsam */}
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                Kapsam
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => { setSelectedCategory(e.target.value); clearBulkPreview(); }}
                className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none cursor-pointer"
              >
                <option value="ALL">Tüm Menü (Bütün Kategoriler)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              className="tactile-btn min-h-12 px-4 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm font-bold border border-[var(--border)] flex items-center gap-1.5 cursor-pointer"
            >
              <span>Önizlemeyi Hesapla</span>
            </button>

            {bulkPreview.length > 0 && (
              <button
                type="button"
                onClick={() => setShowApplyConfirm(true)}
                disabled={busy}
                className="tactile-btn min-h-12 px-5 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-[var(--button)] text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>Fiyatları Uygula ({bulkPreview.length} Ürün)</span>
              </button>
            )}
          </div>
        </div>

        {/* Sonuç Bildirimi */}
        {resultMsg && (
          <div className="p-3 bg-[var(--accent-emerald-soft)] border-b border-[var(--accent-emerald-border)] text-xs font-semibold text-[var(--accent-emerald)] flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{resultMsg}</span>
          </div>
        )}

        {/* Önizleme Tablosu */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[220px]">
          {bulkPreview.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-xs text-[var(--text-muted)] py-12">
              <p>Toplu zam hesaplamak için değer girip &quot;Önizlemeyi Hesapla&quot; butonuna basınız.</p>
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[var(--bg-subtle)] text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
                  <tr>
                    <th className="p-2.5">Ürün</th>
                    <th className="p-2.5 text-right">Eski Fiyat</th>
                    <th className="p-2.5 text-center w-8"></th>
                    <th className="p-2.5 text-right">Öngörülen Fiyat</th>
                    <th className="p-2.5 text-right">Fark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {bulkPreview.map((item) => {
                    const diff = item.newPriceCents - item.oldPriceCents;
                    return (
                      <tr key={item.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="p-2.5 font-medium text-[var(--text-primary)]">{item.name}</td>
                        <td className="p-2.5 text-right tabular-nums text-[var(--text-secondary)] tabular-nums">
                          {formatMoney(item.oldPriceCents)}
                        </td>
                        <td className="p-2.5 text-center text-[var(--text-muted)]">
                          <ArrowRight className="w-3.5 h-3.5 mx-auto" />
                        </td>
                        <td className="p-2.5 text-right tabular-nums font-bold text-[var(--accent-blue)] tabular-nums">
                          {formatMoney(item.newPriceCents)}
                        </td>
                        <td className="p-2.5 text-right tabular-nums text-[var(--accent-emerald)] font-semibold tabular-nums">
                          +{formatMoney(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Sağ Panel: Fiyat Listeleri */}
      {isEnabled('feat_dynamic_pricing') && <div className="w-full lg:w-84 flex flex-col paper border border-[var(--border)] rounded-xl overflow-hidden shadow-sm shrink-0">
        <div className="p-4 bg-[var(--bg-panel)] border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Fiyat Listeleri</h3>
          </div>
          <button
            type="button"
            onClick={() => setIsNewListOpen(true)}
            className="p-2 rounded-lg paper hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
            title="Yeni Liste"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {priceLists.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--text-muted)]">
              Tanımlı özel fiyat listesi yok.
            </div>
          ) : (
            priceLists.map((pl) => (
              <div
                key={pl.id}
                className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-between"
              >
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-primary)]">{pl.name}</h4>
                  {pl.description && (
                    <span className="text-xs text-[var(--text-muted)] block mt-0.5">
                      {pl.description}
                    </span>
                  )}
                  <span className="text-xs tabular-nums text-[var(--text-secondary)] mt-1 block">
                    {pl.items?.length || 0} ürün tanımlı
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingPriceListId(pl.id)}
                  className="w-12 h-12 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-red)] rounded cursor-pointer"
                  title="Listeyi Sil"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>}

      {/* Toplu Zam Onay Modalı */}
      {showApplyConfirm && (
        <div className="fixed inset-0 z-50 glass-scrim flex items-center justify-center p-4">
          <div className="w-84 paper border border-[var(--border)] rounded-xl p-4 space-y-4 shadow-2xl">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">
              Fiyat Güncellemesini Onayla
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              En fazla {bulkPreview.length} ürünün satış fiyatı güncellenecek. Fiyatı dondurulmuş ürünler atlanır; gerçek sonuç işlemden sonra gösterilir.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowApplyConfirm(false)}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={busy}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-bold text-[var(--button)] cursor-pointer disabled:opacity-50"
              >
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fiyat Listesi Silme Onay Modalı */}
      {isEnabled('feat_dynamic_pricing') && deletingPriceListId && (
        <div className="fixed inset-0 z-50 glass-scrim flex items-center justify-center p-4">
          <div className="w-80 paper border border-[var(--border)] rounded-xl p-4 space-y-4 shadow-2xl">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Fiyat Listesini Sil?</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Bu tarife listesi kalıcı olarak silinecek. Onaylıyor musunuz?
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingPriceListId(null)}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleDeletePriceList}
                disabled={busy}
                className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--accent-red)] hover:bg-[var(--danger-hover)] text-sm font-bold text-[var(--danger-fg)] cursor-pointer disabled:opacity-50"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Yeni Fiyat Listesi Modalı */}
      {isEnabled('feat_dynamic_pricing') && isNewListOpen && (
        <div className="fixed inset-0 z-50 glass-scrim flex items-center justify-center p-4">
          <div className="w-84 paper border border-[var(--border)] rounded-xl p-4 space-y-3 shadow-2xl">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">+ Yeni Fiyat Listesi</h3>
            <form onSubmit={handleCreatePriceList} className="space-y-3">
              <div>
                <label htmlFor="tariff-new-name" className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                  Liste Adı
                </label>
                <input
                  id="tariff-new-name"
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="tariff-new-description" className="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-1">
                  Açıklama (İsteğe Bağlı)
                </label>
                <input
          id="tariff-new-description"
                  type="text"
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded-md min-h-12 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewListOpen(false)}
                  className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-sm font-bold text-[var(--text-primary)] border border-[var(--border)] cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="tactile-btn flex-1 min-h-12 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-sm font-bold text-[var(--button)] cursor-pointer disabled:opacity-50"
                >
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
