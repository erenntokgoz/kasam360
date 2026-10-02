/**
 * Tek bir modifier grubunun listelenmesi: seçim kutusu, açılır seçenekler,
 * seçenek ekleme ve silme girişi.
 *
 * Neden ayrı bileşen: grup satırı iki kipte (şablon / ürüne atama) farklı
 * parça gösterir; bu satırı ayırmak `ModifierSection`un tek ekranı okunur
 * kalmasını sağlar ve yetki kapısı (`readOnly`) tek yerde durur.
 */

import { forwardRef } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { formatCents } from './types';
import type { ModifierGroup } from './types';

export interface ModifierGroupRowProps {
    group: ModifierGroup;
    mode: 'template' | 'assign';
    readOnly: boolean;
    isSelected: boolean;
    isExpanded: boolean;
    onToggleSelected: () => void;
    onToggleExpanded: () => void;
    onRequestDelete: () => void;
    onRequestAddOption: () => void;
}

export const ModifierGroupRow = forwardRef<HTMLLIElement, ModifierGroupRowProps>(
    function ModifierGroupRow(
        {
            group,
            mode,
            readOnly,
            isSelected,
            isExpanded,
            onToggleSelected,
            onToggleExpanded,
            onRequestDelete,
            onRequestAddOption,
        },
        ref,
    ) {
        return (
            <li
                ref={ref}
                className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.06] rounded-xl"
            >
                <div className="flex items-center gap-2 p-2">
                    {mode === 'assign' && (
                        <input
                            type="checkbox"
                            id={`mod-group-${group.id}`}
                            checked={isSelected}
                            onChange={onToggleSelected}
                            disabled={readOnly}
                            // Görünür etiket yok; ekran okuyucu grup adını duymalı.
                            aria-label={`${group.name} grubunu ürüne bağla`}
                            className="h-4 w-4 rounded border-zinc-400 dark:bg-white/[0.05] bg-white text-[#007AFF] focus:ring-[#007AFF]"
                        />
                    )}
                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        aria-expanded={isExpanded}
                        className="flex items-center gap-1.5 flex-1 text-left cursor-pointer"
                    >
                        {isExpanded ? (
                            <ChevronDown size={13} aria-hidden="true" />
                        ) : (
                            <ChevronRight size={13} aria-hidden="true" />
                        )}
                        <span className="text-xs font-medium dark:text-zinc-200 text-zinc-800">
                            {group.name}
                        </span>
                        {group.isRequired && (
                            <span className="text-[10px] dark:text-zinc-400 text-zinc-500">
                                zorunlu
                            </span>
                        )}
                    </button>
                    {!readOnly && mode === 'template' && (
                        <button
                            type="button"
                            onClick={onRequestDelete}
                            aria-label={`${group.name} şablonunu sil`}
                            className="rounded-lg p-1 text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer"
                        >
                            <Trash2 size={13} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {isExpanded && (
                    <div className="px-2 pb-2">
                        {group.options.length === 0 ? (
                            <p className="text-[11px] dark:text-zinc-500 text-zinc-500 px-1 pb-1">
                                Bu şablonda seçenek yok.
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {group.options.map(option => (
                                    <li
                                        key={option.id}
                                        className="flex items-center justify-between text-[11px] dark:text-zinc-300 text-zinc-700 px-1"
                                    >
                                        <span>{option.name}</span>
                                        <span className="tabular-nums dark:text-zinc-400 text-zinc-500">
                                            {formatCents(option.priceCents)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {!readOnly && mode === 'template' && (
                            <button
                                type="button"
                                onClick={onRequestAddOption}
                                className="mt-2 inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold dark:bg-white/[0.08] bg-black/[0.05] dark:text-zinc-200 text-zinc-700 transition-all cursor-pointer"
                            >
                                <Plus size={12} aria-hidden="true" />
                                Seçenek ekle
                            </button>
                        )}
                    </div>
                )}
            </li>
        );
    },
);