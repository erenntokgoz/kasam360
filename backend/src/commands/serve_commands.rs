//! Garsonun "Teslim edilecekler" listesi ve tek dokunuşla teslim komutları.
//!
//! Neden ayrı kapı: mutfak bileti yalnız mutfak hattı ilerletir; teslim ise salonun işidir.
//! Garson yalnız `Ready` -> `Served` geçişini yapabilir, hazırlık durumlarına dokunamaz.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use crate::services::lan_sync::WritePool;
use crate::services::serve_service::{self, PendingDeliveryDto};
use crate::AppState;

/// Teslim listesini gören ve kalem teslim eden roller. Mutfak masaya götürmez, MASTER içeri girmez.
const SERVE_ROLES: [crate::rbac::Role; 4] = [
    crate::rbac::Role::Owner,
    crate::rbac::Role::Manager,
    crate::rbac::Role::Waiter,
    crate::rbac::Role::Cashier,
];

/// Rol kapısını fail-closed geçirir ve kiracıyı çözer.
///
/// Neden ayrı fonksiyon: `tauri::State` içeren komutlar doğrudan test edilemez.
pub(crate) fn serve_gate(
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
) -> Result<String, String> {
    crate::rbac::require_any_present(actor_role, &SERVE_ROLES)?;
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

#[tauri::command]
pub async fn list_pending_deliveries(
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<PendingDeliveryDto>, String> {
    let tenant = serve_gate(actor_role.as_deref(), tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    serve_service::list_pending(&mut conn, &tenant, &now).await
}

#[tauri::command]
pub async fn mark_items_served(
    item_ids: Vec<String>,
    tenant_id: Option<String>,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, AppState>,
) -> Result<i64, String> {
    let tenant = serve_gate(actor_role.as_deref(), tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);

    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    let served = serve_service::mark_served(&mut tx, &tenant, &item_ids).await?;

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "kds:items_served",
        item_ids.join(","),
        serde_json::json!({ "itemIds": item_ids, "count": served }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(served)
}
