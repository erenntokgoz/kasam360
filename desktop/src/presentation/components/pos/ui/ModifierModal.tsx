/**
 * ModifierModal — Apple HIG ve Spatial Glass Ürün Opsiyon Modalı
 *
 * Ürün porsiyon, ekstra ve mutfak notu seçimlerini Apple spatial glass
 * ve derin antrasit tasarım diliyle sunar.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { POSProduct, ModifierGroup, ModifierOption } from '../../../types';
import { useModalA11y } from '../../../hooks/useModalA11y';

interface ModifierModalProps {
  product: POSProduct;
  groups: ModifierGroup[];
  onClose: () => void;
  onAddToCart: (modifiers: ModifierOption[], note?: string) => void;
}

export function ModifierModal({ product, groups, onClose, onAddToCart }: ModifierModalProps) {
  const [selectedOptions, setSelectedOptions] = useState<ModifierOption[]>([]);
  const [itemNote, setItemNote] = useState('');

  const { modalRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onClose,
  });

  const toggleOption = (group: ModifierGroup, option: ModifierOption) => {
    setSelectedOptions((prev) => {
      const isSelected = prev.some((o) => o.id === option.id);
      if (isSelected) {
        return prev.filter((o) => o.id !== option.id);
      } else {
        const currentGroupSelections = prev.filter((p) => group.options.some((go) => go.id === p.id));
        if (group.maxSelections && currentGroupSelections.length >= group.maxSelections) {
          // Tekli seçim ise (örn. radyo buton davranışı), eski seçimi yenisiyle değiştir
          if (group.maxSelections === 1) {
            return [...prev.filter((p) => !group.options.some((go) => go.id === p.id)), option];
          }
          return prev;
        }
        return [...prev, option];
      }
    });
  };

  const isGroupValid = (group: ModifierGroup) => {
    const currentSelections = selectedOptions.filter((p) => group.options.some((go) => go.id === p.id)).length;
    return currentSelections >= group.minSelections && (!group.maxSelections || currentSelections <= group.maxSelections);
  };

  const canSubmit = groups.every(isGroupValid);
  const extraTotalCents = selectedOptions.reduce((sum, opt) => sum + opt.priceCents, 0);
  const totalItemCents = (product.price || 0) + extraTotalCents;

  const quickNotes = ['Az Şekerli', 'Buzsuz', 'Acısız', 'Ekstra Sıcak', 'Paket Olsun'];

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modifier-modal-title"
        className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-[28px] shadow-[0_24px_80px_rgba(0,0,0,0.2)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.6)] w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
      >
        {/* Başlık Çubuğu */}
        <div className="p-5 border-b dark:border-white/10 border-black/[0.08] flex justify-between items-center dark:bg-white/[0.02] bg-black/[0.02] backdrop-blur-xl">
          <div>
            <h2 id="modifier-modal-title" className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">{product.name}</h2>
            <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">Porsiyon ve Opsiyon Seçimi</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="h-9 w-9 rounded-full dark:bg-white/10 bg-black/[0.06] dark:text-zinc-400 text-zinc-600 dark:hover:text-white hover:text-zinc-900 dark:hover:bg-white/15 hover:bg-black/10 flex items-center justify-center transition-all active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        {/* Opsiyon Grupları ve Hızlı Notlar */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-2.5">
              <div className="flex justify-between items-end">
                <h3 className="text-sm font-semibold dark:text-zinc-200 text-zinc-800">{group.name}</h3>
                <span className="text-xs dark:text-zinc-400 text-zinc-500 font-medium">
                  {group.minSelections > 0
                    ? `Zorunlu (En az ${group.minSelections})`
                    : 'İsteğe bağlı'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {group.options.map((option) => {
                  const isSelected = selectedOptions.some((o) => o.id === option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleOption(group, option)}
                      className={`p-3.5 rounded-2xl border text-left flex justify-between items-center transition-all duration-150 active:scale-[0.97] touch-manipulation ${
                        isSelected
                          ? 'bg-[#007AFF] border-white/20 text-white shadow-md shadow-[#007AFF]/25 font-semibold'
                          : 'dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] dark:text-zinc-300 text-zinc-800 dark:hover:bg-white/[0.08] hover:bg-zinc-100 shadow-sm'
                      }`}
                    >
                      <span className="truncate text-sm pr-1">{option.name}</span>
                      {option.priceCents > 0 && (
                        <span className={`text-xs font-mono tabular-nums shrink-0 ${isSelected ? 'text-white/90' : 'dark:text-zinc-400 text-zinc-500'}`}>
                          +{(option.priceCents / 100).toFixed(2)}₺
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Mutfak Notu Alanı */}
          <div className="space-y-2.5 pt-3 border-t dark:border-white/10 border-black/[0.08]">
            <label className="text-sm font-semibold dark:text-zinc-300 text-zinc-700">
              Mutfak Notu / Özel İstek
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quickNotes.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setItemNote((prev) => (prev ? `${prev}, ${note}` : note))}
                  className="rounded-full dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] px-3 py-1 text-xs dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/[0.08] active:scale-95 transition-all"
                >
                  +{note}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={itemNote}
              onChange={(e) => setItemNote(e.target.value)}
              placeholder="Örn: Az şekerli olsun, hemen çıksın..."
              className="w-full rounded-2xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.05] bg-black/[0.03] hover:dark:bg-white/[0.08] hover:bg-black/[0.05] px-3.5 py-2.5 text-sm dark:text-zinc-100 text-zinc-900 placeholder:text-zinc-400 focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/25 focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Alt Toplam ve Sepete Ekle Butonu */}
        <div className="p-5 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] backdrop-blur-xl flex items-center justify-between gap-4">
          <div>
            <div className="text-xs dark:text-zinc-400 text-zinc-500">Birim Toplam</div>
            <div className="text-xl font-bold font-mono text-[#34C759] tabular-nums tracking-tight">
              {(totalItemCents / 100).toFixed(2)} ₺
            </div>
          </div>
          <button
            disabled={!canSubmit}
            onClick={() => onAddToCart(selectedOptions, itemNote.trim() || undefined)}
            className={`flex-1 py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] ${
              canSubmit
                ? 'bg-[#007AFF] text-white hover:bg-[#006ee6] shadow-lg shadow-[#007AFF]/30'
                : 'dark:bg-white/[0.05] bg-black/[0.05] dark:text-zinc-500 text-zinc-400 cursor-not-allowed border dark:border-white/5 border-black/5'
            }`}
          >
            Sepete Ekle
          </button>
        </div>
      </div>
    </div>
  );
}
