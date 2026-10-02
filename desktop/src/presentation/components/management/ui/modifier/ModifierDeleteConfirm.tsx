/**
 * Şablon silme onayı.
 *
 * Neden ayrı onay: silme geri alınamaz ve grup seçeneklerini de siler;
 * onay metni kaç şablonun etkilendiğini açıkça söylemelidir.
 */

import { forwardRef } from 'react';

export interface ModifierDeleteConfirmProps {
    groupName: string;
    optionCount: number;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ModifierDeleteConfirm = forwardRef<HTMLDivElement, ModifierDeleteConfirmProps>(
    function ModifierDeleteConfirm({ groupName, optionCount, busy, onConfirm, onCancel }, ref) {
        return (
            <div
                ref={ref}
                className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-3 space-y-2"
            >
                <p className="text-[11px] dark:text-zinc-200 text-zinc-800">
                    &quot;{groupName}&quot; şablonu ve {optionCount} seçeneği silinecek. Bu işlem geri
                    alınamaz.
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
                        onClick={onConfirm}
                        disabled={busy}
                        className="rounded-xl px-3 py-1.5 text-[11px] font-semibold text-white bg-[#FF3B30] hover:bg-[#D70015] disabled:opacity-40 cursor-pointer"
                    >
                        Sil
                    </button>
                </div>
            </div>
        );
    },
);