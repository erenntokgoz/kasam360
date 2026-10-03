//! Faz 12 Tauri komutlarının ortak güvenlik katmanı.
//!
//! Bu katman **yalnız yetki sınar ve servise delegasyon yapar**; iş mantığı
//! `services/inventory360` içindedir. Böylece iş mantığı komut altyapısı olmadan
//! testlenebilir ve yetki değişikliği tek yerde toplanır.
//!
//! Üç kural her komutta aynıdır:
//!   1. Rol `rbac::require_any` ile önce sınanır — servis çağrısından önce.
//!   2. Tenant `require_tenant` ile çözülür; boş oturum reddedilir.
//!   3. Mali etkisi olan yazma işlemleri `audit_mutex` alır ve denetim
//!      defterine yazılır.

pub mod menu_availability_commands;
pub mod pricing_commands;
pub mod recipe_commands;
pub mod shelf_life_commands;
pub mod supplier_commands;
pub mod waste_commands;

#[cfg(test)]
mod tests;

pub use menu_availability_commands::{
    get_pricing_rules, get_service_windows, set_menu_window_product, set_product_active_window,
    upsert_pricing_rule_command, upsert_service_window_command,
};
pub use pricing_commands::{
    bulk_update_product_prices, create_price_freeze_command, create_price_list_command,
    delete_price_list_command, get_effective_price, list_price_lists, set_product_86d_command,
};
pub use recipe_commands::{
    create_recipe_command, deactivate_recipe_command, get_recipe_cost, list_inventory_recipes,
};
pub use shelf_life_commands::{
    get_expiry_report, list_shelf_life_policies_command, set_batch_expiry_date,
    upsert_shelf_life_policy_command,
};
pub use supplier_commands::{
    compare_supplier_prices_command, create_purchase_order_command, get_inventory_suppliers,
    receive_purchase_order_command, set_supplier_product_command, upsert_supplier_command,
};
pub use waste_commands::{
    close_stock_count_command, get_stock_count_command, list_stock_counts_command,
    list_waste_records_command, open_stock_count_command, record_count_line_command,
    record_waste_command,
};

use crate::db::DbPool;
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Mali etkisi olan yazma işlemlerinin denetim defteri kaydı.
///
/// `FINANS` kategorisi stok hareketi ve maliyet değişimleri için, `MENU`
/// kategorisi menü görünürlüğü ve fiyat için kullanılır. Yeni kategori açılmaz:
/// `audit_service::category::ALL` donmuş bir kümedir.
pub(crate) async fn record_audit(
    conn: &mut sqlx::SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    category: &'static str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    Ok(())
}

/// Çağıran oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır.
pub(crate) fn audit_actor(actor_id: Option<String>, actor_role: &str) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.to_string(),
    )
}

/// Çağıranın işletmesini çözer ve fail-closed doğrular.
///
/// Tenant hiçbir zaman hedef satırdan okunmaz: okunursa bir işletme sahibi
/// başka işletmenin `prd_...` kimliğini tahmin edip değiştirebilir ve denetim
/// kaydı kurbanın defterine yazılır.
pub(crate) fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    let tenant = tenant_id.unwrap_or("").trim();
    if tenant.is_empty() {
        return Err("UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi".into());
    }
    Ok(tenant.to_string())
}

/// `feat_dynamic_pricing` bayrağı KAPALI iken dinamik tarife komutları 404 döner.
///
/// Neden 404 ve 403 değil: bayrak kapalıyken özellik **yoktur**; 403 "var ama
/// yetkin yok" der ve arayüzde yanlış bir boş ekran gösterir. AGENTS.md §3.3
/// bayrak kapalıyken 404 dönmeyi zorunlu kılar.
pub(crate) fn require_dynamic_pricing(active_modules: Option<&Vec<String>>) -> Result<(), String> {
    match active_modules {
        Some(moduller) if moduller.iter().any(|m| m == "feat_dynamic_pricing") => Ok(()),
        _ => Err("NOT_FOUND: dinamik tarife bu işletmede etkin değil".into()),
    }
}

/// `feat_recipe_bom` bayrağı KAPALI iken reçete komutları 404 döner.
pub(crate) fn require_recipe_bom(active_modules: Option<&Vec<String>>) -> Result<(), String> {
    match active_modules {
        Some(moduller) if moduller.iter().any(|m| m == "feat_recipe_bom") => Ok(()),
        _ => Err("NOT_FOUND: reçete ve maliyet dökümü bu işletmede etkin değil".into()),
    }
}

/// `feat_loss_radar` bayrağı KAPALI iken raf ömrü komutları 404 döner.
///
/// Fire kaydı bu bayrağa bağlı değildir: fire bir maliyet olayıdır ve
/// kapatılırsa zarar kaydı tutulmaz. Raf ömrü ise **önleyici** bir izlemedir;
/// kapalıyken çalıştırılması doğru olmaz.
pub(crate) fn require_loss_radar(active_modules: Option<&Vec<String>>) -> Result<(), String> {
    match active_modules {
        Some(moduller) if moduller.iter().any(|m| m == "feat_loss_radar") => Ok(()),
        _ => Err("NOT_FOUND: raf ömrü ve fire radarı bu işletmede etkin değil".into()),
    }
}

/// Havuz bağlantısı alır. Bağlantı hatası `Err` olarak yukarı taşınır, sessizce
/// boş sonuç dönülmez.
pub(crate) async fn acquire(pool: &DbPool) -> Result<sqlx::SqliteConnection, String> {
    pool.acquire()
        .await
        .map(|baglanti| baglanti.detach())
        .map_err(|e| e.to_string())
}
