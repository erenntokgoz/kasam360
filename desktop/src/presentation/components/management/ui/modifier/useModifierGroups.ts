/**
 * Modifier grubu verisi ve komutlarının tek yolu.
 *
 * Neden ayrı: `CategoryForm` ve `ProductForm` aynı listeyi aynı kurallarla
 * yönetir. Yönetim mantığı iki bileşende çoğalırsa iki ekran farklı davranır
 * ve güvenlik kapısı (OWNER, tenant izolasyonu, negatif fiyat) birinde
 * unutulabilir. Bu yüzden komutlar tek yerden çağrılır.
 */

import { useCallback, useEffect, useState } from 'react';

import { tauriInvoke } from '../../../../../data/ipc/tauriInvoke';
import type { ModifierGroup, ModifierSectionMode } from './types';

interface UseModifierGroupsArgs {
    mode: ModifierSectionMode;
    /** `template` kipinde şablonun bağlanacağı kategori kimliği. */
    categoryId: string | null;
    actorRole: string;
    tenantId: string;
}

interface Notice {
    message: string;
    /** Aynı mesajın tekrar tekrar gösterilmesini engeller. */
    stamp: number;
}

export function useModifierGroups({ mode, categoryId, actorRole, tenantId }: UseModifierGroupsArgs) {
    const [groups, setGroups] = useState<ModifierGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);

    const flash = useCallback((message: string) => {
        setNotice({ message, stamp: Date.now() });
    }, []);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 4000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await tauriInvoke<ModifierGroup[]>('get_modifier_groups', {
                actorRole,
                actor_role: actorRole,
                tenantId,
                tenant_id: tenantId,
                // `assign` kipinde tüm gruplar listelenir; kategori şablonu
                // ürüne öneri olarak ayrıca ele alınır.
                categoryId: mode === 'template' ? categoryId : undefined,
            });
            const list = data || [];
            setGroups(list);
            setExpanded(Object.fromEntries(list.map(g => [g.id, true])));
        } catch (e) {
            setError(typeof e === 'string' ? e : 'Seçenekler alınamadı.');
        } finally {
            setLoading(false);
        }
    }, [actorRole, tenantId, mode, categoryId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const toggleExpanded = useCallback((groupId: string) => {
        setExpanded(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    }, []);

    /** Yeni şablon/grup oluşturur. `template` kipinde kategoriye bağlanır. */
    const createGroup = useCallback(
        async (name: string): Promise<boolean> => {
            const trimmed = name.trim();
            if (!trimmed) return false;
            setBusy(true);
            setError(null);
            try {
                await tauriInvoke('create_modifier_group', {
                    actorRole,
                    actor_role: actorRole,
                    name: trimmed,
                    isRequired: false,
                    is_required: false,
                    minSelections: 0,
                    min_selections: 0,
                    maxSelections: null,
                    max_selections: null,
                    tenantId,
                    tenant_id: tenantId,
                    categoryId: mode === 'template' ? categoryId ?? null : null,
                });
                flash(`"${trimmed}" şablonu oluşturuldu.`);
                await refresh();
                return true;
            } catch (e) {
                setError(typeof e === 'string' ? e : 'Şablon oluşturulamadı.');
                return false;
            } finally {
                setBusy(false);
            }
        },
        [actorRole, tenantId, mode, categoryId, flash, refresh],
    );

    /**
     * Seçenek ekler. Fiyat farkı kuruş olarak gönderilir; negatif değer
     * istemcide de reddedilir, backend ikinci kez doğrular.
     */
    const addOption = useCallback(
        async (groupId: string, name: string, priceCents: number): Promise<boolean> => {
            const trimmed = name.trim();
            if (!trimmed) return false;
            if (priceCents < 0) {
                setError('Fiyat farkı negatif olamaz.');
                return false;
            }
            setBusy(true);
            setError(null);
            try {
                await tauriInvoke('add_modifier_option', {
                    actorRole,
                    actor_role: actorRole,
                    groupId,
                    group_id: groupId,
                    name: trimmed,
                    priceCents,
                    price_cents: priceCents,
                    tenantId,
                    tenant_id: tenantId,
                });
                flash(`"${trimmed}" seçeneği eklendi.`);
                await refresh();
                return true;
            } catch (e) {
                setError(typeof e === 'string' ? e : 'Seçenek eklenemedi.');
                return false;
            } finally {
                setBusy(false);
            }
        },
        [actorRole, tenantId, flash, refresh],
    );

    const deleteGroup = useCallback(
        async (groupId: string, groupName: string): Promise<boolean> => {
            setBusy(true);
            setError(null);
            try {
                await tauriInvoke('delete_modifier_group', {
                    actorRole,
                    actor_role: actorRole,
                    groupId,
                    group_id: groupId,
                    tenantId,
                    tenant_id: tenantId,
                });
                flash(`"${groupName}" şablonu silindi.`);
                await refresh();
                return true;
            } catch (e) {
                setError(typeof e === 'string' ? e : 'Şablon silinemedi.');
                return false;
            } finally {
                setBusy(false);
            }
        },
        [actorRole, tenantId, flash, refresh],
    );

    return {
        groups,
        loading,
        error,
        notice: notice?.message ?? null,
        expanded,
        busy,
        refresh,
        toggleExpanded,
        createGroup,
        addOption,
        deleteGroup,
    };
}