//! Kapanmış adisyon değişiklik talebi komutları.
//!
//! Her açılış ve karar denetim defterine yazılır; sahibin kritik işlemler geçmişi
//! bu kayıtlardan okunur.

use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::lan_sync::write_tx::WritePool;
use crate::services::order_change::{self, NewRequest, OrderChangeRequest};

const DECIDERS: [Role; 2] = [Role::Owner, Role::Manager];

/// Müdür ve sahibin talebi ayrıca onay beklemez.
#[tauri::command]
pub async fn create_order_change_request(
    order_id: String,
    reason: String,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    state.lan_sync.require_local_write()?;
    let role = crate::rbac::require_any(
        &actor_role,
        &[Role::Owner, Role::Manager, Role::Cashier, Role::Waiter],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let now = chrono::Local::now().to_rfc3339();
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    let id = order_change::create(
        &mut tx,
        &tenant,
        &NewRequest {
            order_id: &order_id,
            reason: &reason,
            actor_id: &actor_id,
            approved_by_actor: DECIDERS.contains(&role),
            now: &now,
        },
    )
    .await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        category::SIPARIS_MASA,
        "order_change:requested",
        id.clone(),
        serde_json::json!({ "orderId": order_id, "reason": reason.trim() }),
        now,
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn list_order_change_requests(
    only_open: Option<bool>,
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<OrderChangeRequest>, String> {
    crate::rbac::require_any(&actor_role, &DECIDERS)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    order_change::list(&mut conn, &tenant, only_open.unwrap_or(true)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn decide_order_change_request(
    id: String,
    approve: bool,
    note: Option<String>,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_any(&actor_role, &DECIDERS)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let now = chrono::Local::now().to_rfc3339();
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    let status = order_change::decide(
        &mut tx,
        &tenant,
        &id,
        approve,
        &actor_id,
        note.as_deref(),
        &now,
    )
    .await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        category::SIPARIS_MASA,
        "order_change:decided",
        id,
        serde_json::json!({ "status": status, "note": note }),
        now,
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(status)
}

/// İade yapıldıktan sonra ya da iade gerekmediğinde onaylı talebi kapatır.
#[tauri::command]
pub async fn resolve_order_change_request(
    id: String,
    refunded: bool,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_any(&actor_role, &DECIDERS)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let now = chrono::Local::now().to_rfc3339();
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    order_change::resolve(&mut tx, &tenant, &id, &actor_id, &now).await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        category::SIPARIS_MASA,
        "order_change:resolved",
        id,
        serde_json::json!({ "refunded": refunded }),
        now,
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(())
}
