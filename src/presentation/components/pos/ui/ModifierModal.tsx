import { useState } from 'react';
import { POSProduct, ModifierGroup, ModifierOption } from '../../../types';

interface ModifierModalProps {
  product: POSProduct;
  groups: ModifierGroup[];
  onClose: () => void;
  onAddToCart: (modifiers: ModifierOption[], note?: string) => void;
}

export function ModifierModal({ product, groups, onClose, onAddToCart }: ModifierModalProps) {
  const [selectedOptions, setSelectedOptions] = useState<ModifierOption[]>([]);
  const [itemNote, setItemNote] = useState('');

  const toggleOption = (group: ModifierGroup, option: ModifierOption) => {
    setSelectedOptions((prev) => {
      const isSelected = prev.some((o) => o.id === option.id);
      if (isSelected) {
        return prev.filter((o) => o.id !== option.id);
      } else {
        const currentGroupSelections = prev.filter((p) => group.options.some((go) => go.id === p.id));
        if (group.maxSelections && currentGroupSelections.length >= group.maxSelections) {
          // If maxSelections is 1 (single choice radio-style), replace the selection
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
          <div>
            <h2 className="text-xl font-bold text-white">{product.name}</h2>
            <p className="text-xs text-slate-400">Porsiyon ve Opsiyon Seçimi</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex justify-between items-end">
                <h3 className="text-sm font-semibold text-slate-200">{group.name}</h3>
                <span className="text-xs text-slate-400">
                  {group.minSelections > 0
                    ? `Zorunlu (En az ${group.minSelections})`
                    : 'İsteğe bağlı'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {group.options.map((option) => {
                  const isSelected = selectedOptions.some((o) => o.id === option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleOption(group, option)}
                      className={`p-3 rounded-xl border text-left flex justify-between items-center transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <span className="truncate text-sm font-medium pr-1">{option.name}</span>
                      {option.priceCents > 0 && (
                        <span className={`text-xs font-semibold tabular-nums shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`}>
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
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="text-sm font-semibold text-slate-300">
              Mutfak Notu / Özel İstek
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quickNotes.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setItemNote((prev) => (prev ? `${prev}, ${note}` : note))}
                  className="rounded-full bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-300 border border-slate-700 transition-colors"
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
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">Birim Toplam</div>
            <div className="text-lg font-bold text-emerald-400 tabular-nums">
              {(totalItemCents / 100).toFixed(2)}₺
            </div>
          </div>
          <button
            disabled={!canSubmit}
            onClick={() => onAddToCart(selectedOptions, itemNote.trim() || undefined)}
            className={`flex-1 py-3 rounded-xl font-bold text-base transition-all ${
              canSubmit
                ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            Sepete Ekle
          </button>
        </div>
      </div>
    </div>
  );
}
