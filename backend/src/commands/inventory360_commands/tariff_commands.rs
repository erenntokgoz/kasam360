//! Elle tarife komutları. `feat_dynamic_pricing` bayrağına bağlı değildir: bayrak saate
//! bağlı kuralı kapatır, patronun açık kararıyla yapılan fiyat değişikliğini değil.
//!
//! Tarifeyi patron tanımlar; servis sırasında açıp kapatmak müdürün de işidir.

use crate::services::lan_sync::WritePool;
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::pricing::{self, PriceTariff, TariffInput};

#[tauri::command]
pub async fn get_price_tariffs(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<PriceTariff>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    pricing::list_tariffs(&mut conn, &tenant_id).await
}

/// Satış ekranı açık tarifeyi gösterir; rol sınırı yoktur, fiyat zaten görünür.
#[tauri::command]
pub async fn get_active_price_tariff(
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Option<PriceTariff>, String> {
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    pricing::active_tariff(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn save_price_tariff(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    input: TariffInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let details = serde_json::json!({ "name": input.name, "percent": input.percent });

    let mut conn = pool.begin_write().await?;
    let id = pricing::save_tariff(&mut conn, &tenant_id, &actor_id, input).await?;
    record_audit(
        &mut conn,
        &lock,
        &tenant_id,
        &actor_id,
        &actor_role,
        category::MENU,
        "tarife:saved",
        &id,
        details,
    )
    .await?;
    conn.commit().await?;
    Ok(id)
}

/// `tariff_id` boşsa açık tarife kapanır.
#[tauri::command]
pub async fn set_active_price_tariff(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    tariff_id: Option<String>,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    let mut conn = pool.begin_write().await?;
    pricing::set_active_tariff(&mut conn, &tenant_id, &actor_id, tariff_id.as_deref()).await?;
    record_audit(
        &mut conn,
        &lock,
        &tenant_id,
        &actor_id,
        &actor_role,
        category::MENU,
        if tariff_id.is_some() {
            "tarife:activated"
        } else {
            "tarife:deactivated"
        },
        tariff_id.as_deref().unwrap_or("menu"),
        serde_json::json!({}),
    )
    .await?;
    conn.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_price_tariff(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    tariff_id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    let mut conn = pool.begin_write().await?;
    pricing::delete_tariff(&mut conn, &tenant_id, &tariff_id).await?;
    record_audit(
        &mut conn,
        &lock,
        &tenant_id,
        &actor_id,
        &actor_role,
        category::MENU,
        "tarife:deleted",
        &tariff_id,
        serde_json::json!({}),
    )
    .await?;
    conn.commit().await?;
    Ok(())
}
