/**
 * "Seçenekler & Ekstralar" — menü yönetimine gömülü modifier yüzeyi.
 *
 * Faz 4: bağımsız `OwnerModifiersTab` sekmesi kaldırıldı; bu bileşen hem
 * `CategoryForm` (kategori şablonları) hem `ProductForm` (ürüne bağlanan
 * gruplar) içinde aynı işi yapar. İki ayrı yönetim yüzeyi olmasın diye tek
 * bileşen ve tek veri yolu vardır.
 *
 * İki kip vardır:
 * - `template`: grubu bir **kategoriye** bağlar (`modifier_groups.category_id`).
 *   Ürün eklenirken bu şablonlar seçilebilir hale gelir.
 * - `assign`: grubu bir **ürüne** bağlar (`product_modifier_groups`).
 *
 * Fiyat farkı ürünün temel fiyatına **eklenmez**; `priceCents` yalnız
 * seçeneğin kendi fiyat farkıdır ve sunucu sipariş anında bunu ayrıca toplar.
 *
 * Veri ve komutlar `useModifierGroups` içindedir; bu dosya yalnız düzendir.
 */

import { useState } from 'react';
import { RefreshCw, TriangleAlert, Wrench } from 'lucide-react';
import { useAuthStore } from '../../../store/useAuthStore';
import { ModifierDeleteConfirm } from './modifier/ModifierDeleteConfirm';
import { ModifierGroupRow } from './modifier/ModifierGroupRow';
import { ModifierOptionForm } from './modifier/ModifierOptionForm';
import { useModifierGroups } from './modifier/useModifierGroups';
import type { ModifierGroup, ModifierSectionProps } from './modifier/types';

export type {
    ModifierGroup,
    ModifierOption,
    ModifierSectionMode,
    ModifierSectionProps,
} from './modifier/types';

export function ModifierSection({
    mode,
    categoryId = null,
    selectedGroupIds = [],
    onSelectionChange,
    productCategoryId = null,
    readOnly = false,
}: ModifierSectionProps) {
    const user = useAuthStore(s => s.user);
    const actorRole = user?.role || 'OWNER';
    const tenantId = user?.tenantId || 'DEFAULT_TENANT';

    const {
        groups,
        loading,
        error,
        notice,
        expanded,
        busy,
        refresh,
        toggleExpanded,
        createGroup,
        addOption,
        deleteGroup,
    } = useModifierGroups({ mode, categoryId, actorRole, tenantId });

    const [groupName, setGroupName] = useState('');
    const [optionFor, setOptionFor] = useState<ModifierGroup | null>(null);
    const [optionName, setOptionName] = useState('');
    const [optionPrice, setOptionPrice] = useState('0');
    const [pendingDelete, setPendingDelete] = useState<ModifierGroup | null>(null);

    const handleCreateGroup = async () => {
        if (await createGroup(groupName)) setGroupName('');
    };

    const handleAddOption = async () => {
        if (!optionFor) return;
        // Fiyat farkı kuruş olarak saklanır; ondalık ayrımda virgül kabul edilir.
        const priceCents = Math.round((Number(optionPrice.replace(',', '.')) || 0) * 100);
        if (await addOption(optionFor.id, optionName, priceCents)) {
            setOptionFor(null);
            setOptionName('');
            setOptionPrice('0');
        }
    };

    const handleDeleteGroup = async () => {
        if (!pendingDelete) return;
        if (await deleteGroup(pendingDelete.id, pendingDelete.name)) setPendingDelete(null);
    };

    const toggleGroup = (groupId: string) => {
        if (!onSelectionChange) return;
        onSelectionChange(
            selectedGroupIds.includes(groupId)
                ? selectedGroupIds.filter(id => id !== groupId)
                : [...selectedGroupIds, groupId],
        );
    };

    /**
     * B4: ürünün kategorisine bağlı şablonlar.
     *
     * Neden ayrı sorgu değil: `assign` kipinde liste **tüm** grupları gösterir
     * (serbest + şablon) ve şablonlar aynı tabloda durur
     * (`modifier_groups.category_id`); ayrı bir şablon tablosu yoktur.
     */
    const unassignedTemplates = groups.filter(
        g => g.categoryId === productCategoryId && !selectedGroupIds.includes(g.id),
    );

    const assignAllCategoryTemplates = () => {
        if (!onSelectionChange) return;
        onSelectionChange([...new Set([...selectedGroupIds, ...unassignedTemplates.map(g => g.id)])]);
    };

    const isSelected = (groupId: string) => selectedGroupIds.includes(groupId);

    // Yeni kategori henüz kaydedilmediyse kimliği yoktur; şablon bağlanamaz.
    if (mode === 'template' && !categoryId) {
        return (
            <section className="dark:bg-white/[0.04] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4">
                <h3 className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 flex items-center gap-2">
                    <Wrench size={14} aria-hidden="true" />
                    Seçenekler &amp; Ekstralar
                </h3>
                <p className="mt-2 text-[11px] dark:text-zinc-500 text-zinc-500">
                    Kategoriyi kaydettiğinizde bu başlığa seçenek şablonları ekleyebilirsiniz.
                </p>
            </section>
        );
    }

    return (
        <section className="dark:bg-white/[0.04] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 space-y-3">
            <header className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold dark:text-zinc-300 text-zinc-700 flex items-center gap-2">
                    <Wrench size={14} aria-hidden="true" />
                    Seçenekler &amp; Ekstralar
                </h3>
                {!readOnly && (
                    <button
                        type="button"
                        onClick={refresh}
                        aria-label="Seçenekleri yenile"
                        className="rounded-xl p-1.5 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
                    >
                        <RefreshCw size={13} aria-hidden="true" />
                    </button>
                )}
            </header>

            {mode === 'assign' && (
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500">
                    Seçtiğiniz gruplar bu ürünü katalogda açıldığında seçim penceresinde çıkar.
                    Seçenek fiyatı, ürünün temel fiyatına eklenmez; sipariş anında ayrıca toplanır.
                </p>
            )}
            {mode === 'assign' && productCategoryId && unassignedTemplates.length > 0 && !readOnly && (
                <button
                    type="button"
                    onClick={assignAllCategoryTemplates}
                    className="w-full rounded-xl px-3 py-2 text-[11px] font-semibold dark:bg-white/[0.08] bg-black/[0.05] dark:text-zinc-200 text-zinc-700 hover:dark:bg-white/[0.12] transition-all cursor-pointer"
                >
                    Bu kategorinin {unassignedTemplates.length} şablonunu ekle
                </button>
            )}
            {mode === 'template' && (
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500">
                    Bu kategoriye bağlı şablonlar, aynı kategorideki ürünlere atanabilir.
                </p>
            )}

            {error && (
                <p role="alert" className="text-[11px] text-rose-400 flex items-start gap-1.5">
                    <TriangleAlert size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" aria-live="polite" className="text-[11px] text-emerald-500">
                    {notice}
                </p>
            )}

            {loading ? (
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500">Yükleniyor...</p>
            ) : groups.length === 0 ? (
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500">
                    {mode === 'template'
                        ? 'Bu kategoriye bağlı seçenek şablonu yok.'
                        : 'Tanımlı seçenek grubu yok.'}
                </p>
            ) : (
                <ul className="space-y-2">
                    {groups.map(group => (
                        <ModifierGroupRow
                            key={group.id}
                            group={group}
                            mode={mode}
                            readOnly={readOnly}
                            isSelected={isSelected(group.id)}
                            isExpanded={expanded[group.id] ?? false}
                            onToggleSelected={() => toggleGroup(group.id)}
                            onToggleExpanded={() => toggleExpanded(group.id)}
                            onRequestDelete={() => setPendingDelete(group)}
                            onRequestAddOption={() => setOptionFor(group)}
                        />
                    ))}
                </ul>
            )}

            {!readOnly && mode === 'template' && (
                <div className="flex gap-2 pt-1">
                    <label htmlFor="new-modifier-group" className="sr-only">
                        Yeni şablon adı
                    </label>
                    <input
                        id="new-modifier-group"
                        type="text"
                        value={groupName}
                        onChange={e => setGroupName(e.target.value)}
                        placeholder="Örn: Pişme Derecesi"
                        className="flex-1 dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 dark:text-white text-zinc-900 text-xs placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                    />
                    <button
                        type="button"
                        onClick={handleCreateGroup}
                        disabled={busy || !groupName.trim()}
                        className="rounded-xl px-3 py-2 text-xs font-semibold text-white bg-[#007AFF] hover:bg-[#0066CC] disabled:opacity-40 transition-all cursor-pointer"
                    >
                        Şablon ekle
                    </button>
                </div>
            )}

            {optionFor && !readOnly && (
                <ModifierOptionForm
                    groupName={optionFor.name}
                    optionName={optionName}
                    optionPrice={optionPrice}
                    busy={busy}
                    onNameChange={setOptionName}
                    onPriceChange={setOptionPrice}
                    onSubmit={handleAddOption}
                    onCancel={() => setOptionFor(null)}
                />
            )}

            {pendingDelete && (
                <ModifierDeleteConfirm
                    groupName={pendingDelete.name}
                    optionCount={pendingDelete.options.length}
                    busy={busy}
                    onConfirm={handleDeleteGroup}
                    onCancel={() => setPendingDelete(null)}
                />
            )}
        </section>
    );
}