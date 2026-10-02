/**
 * Bir gruba yeni seçenek ekleme formu.
 *
 * Fiyat farkı girişte ondalık görünür, komut katmanında kuruşa çevrilir.
 * Alan ayrı bileşen olur ki ana yüzey tek ekranı okunur kalsın.
 */

import { forwardRef } from 'react';

export interface ModifierOptionFormProps {
    groupName: string;
    optionName: string;
    optionPrice: string;
    busy: boolean;
    onNameChange: (value: string) => void;
    onPriceChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
}

export const ModifierOptionForm = forwardRef<HTMLDivElement, ModifierOptionFormProps>(
    function ModifierOptionForm(
        {
            groupName,
            optionName,
            optionPrice,
            busy,
            onNameChange,
            onPriceChange,
            onSubmit,
            onCancel,
        },
        ref,
    ) {
        return (
            <div
                ref={ref}
                className="rounded-xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.06] p-3 space-y-2"
            >
                <p className="text-[11px] font-semibold dark:text-zinc-200 text-zinc-800">
                    &quot;{groupName}&quot; için yeni seçenek
                </p>
                <div className="flex gap-2">
                    <label htmlFor="modifier-option-name" className="sr-only">
                        Seçenek adı
                    </label>
                    <input
                        id="modifier-option-name"
                        type="text"
                        value={optionName}
                        onChange={e => onNameChange(e.target.value)}
                        placeholder="Seçenek adı"
                        className="flex-1 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 dark:text-white text-zinc-900 text-xs placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                    />
                    <label htmlFor="modifier-option-price" className="sr-only">
                        Fiyat farkı (₺)
                    </label>
                    <input
                        id="modifier-option-price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={optionPrice}
                        onChange={e => onPriceChange(e.target.value)}
                        className="w-24 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 dark:text-white text-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                    />
                </div>
                <p className="text-[10px] dark:text-zinc-500 text-zinc-500">
                    Fiyat farkı ürün fiyatına eklenmez; seçildiğinde kalem fiyatına ayrıca eklenir.
                </p>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-xl px-3 py-1.5 text-[11px] font-semibold dark:text-zinc-300 text-zinc-600 dark:bg-white/[0.08] bg-black/[0.05] cursor-pointer"
                    >
                        Vazgeç
                    </button>
                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={busy || !optionName.trim()}
                        className="rounded-xl px-3 py-1.5 text-[11px] font-semibold text-white bg-[#007AFF] hover:bg-[#0066CC] disabled:opacity-40 cursor-pointer"
                    >
                        Ekle
                    </button>
                </div>
            </div>
        );
    },
);