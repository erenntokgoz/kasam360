//! Kalan tutarı sıfır olan adisyonun kapatılması.
//!
//! Neden ayrı komut: tamamı ikram edilen ya da tüm kalemleri iptal edilen masada
//! tahsil edilecek tutar kalmaz; ödeme ekranı sıfır tahsilatı reddettiği için masa
//! "dolu" olarak takılı kalıyordu. Para hareketi yazılmaz, yalnız adisyon kapanır.

use crate::commands::command_helpers::{audit_actor, require_tenant_id};
use crate::db::DbPool;
use crate::services::lan_sync::WritePool;
use sqlx::Row;

#[tauri::command]
pub async fn close_zero_balance_table(
    table_id: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    use crate::rbac::Role;
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[Role::Owner, Role::Manager, Role::Cashier],
    )?;
    state.lan_sync.require_local_write()?;
    let tenant = require_tenant_id(Some(tenant_id.as_str()))?;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;

    let order_ids: Vec<String> = sqlx::query(
        "SELECT id FROM orders
         WHERE tenant_id = ? AND table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(&tenant)
    .bind(&table_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|row| row.try_get::<String, _>("id").map_err(|e| e.to_string()))
    .collect::<Result<_, _>>()?;
    if order_ids.is_empty() {
        return Err("NOT_FOUND: masada açık adisyon yok".to_string());
    }

    // Kuruş kalan adisyon bu yoldan kapanamaz: tahsilatsız satış olurdu.
    for order_id in &order_ids {
        let balance =
            crate::services::order_settlement::order_balance(&mut tx, &tenant, order_id).await?;
        if balance.remaining_cents != 0 {
            return Err(format!(
                "INVALID_STATE: adisyonda {} kuruş kalan var; ödeme ekranından alın.",
                balance.remaining_cents
            ));
        }
    }

    for order_id in &order_ids {
        crate::repositories::payment_repository::PaymentRepository::close_order_if_applicable(
            &mut tx,
            Some(order_id),
            &tenant,
        )
        .await?;
    }

    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:closed_zero_balance",
        table_id,
        serde_json::json!({ "orderIds": order_ids }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
