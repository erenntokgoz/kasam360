/**
 * Ürün → modifier grubu atamasının tek giriş noktası.
 *
 * Neden ayrı: atama hem "hangi gruplar bağlı?" okumasını hem de kaydı içerir ve
 * ikisi de **oturumun tenant'ını** taşımak zorundadır. Bu çağrı iki ekranda
 * (Patron menü sekmesi ve yönetici paneli) tekrarlanıyordu; tenant'ı unutan bir
 * çağrı sessizce yanlış işletmenin verisine bakar. Kural tek yerde olmalı.
 */

import { tauriInvoke } from './tauriInvoke';

interface ActorContext {
    actorRole: string;
    tenantId?: string;
}

/** Ürünün bağlı olduğu grup kimlikleri. Hata durumunda boş liste döner. */
export async function loadProductModifierGroupIds(
    productId: string,
    ctx: ActorContext,
): Promise<string[]> {
    try {
        const ids = await tauriInvoke<string[]>('get_product_modifier_group_ids', {
            actorRole: ctx.actorRole,
            actor_role: ctx.actorRole,
            productId,
            product_id: productId,
            tenantId: ctx.tenantId,
            tenant_id: ctx.tenantId,
        });
        return ids || [];
    } catch {
        // Form açılmayı engellememeli; boş atama ile devam eder.
        return [];
    }
}

/**
 * Ürünün grup atamasını **değiştirir** (küme semantiği). Boş liste atamayı
 * temizler. Yetki hatası çağırana fırlatılır; sessizce yutulmaz.
 */
export async function saveProductModifierGroupIds(
    productId: string,
    groupIds: string[],
    ctx: ActorContext,
): Promise<void> {
    await tauriInvoke('set_product_modifier_groups', {
        actorRole: ctx.actorRole,
        actor_role: ctx.actorRole,
        productId,
        product_id: productId,
        groupIds,
        group_ids: groupIds,
        tenantId: ctx.tenantId,
        tenant_id: ctx.tenantId,
    });
}