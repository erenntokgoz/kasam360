use super::TIP_WRITERS;
use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use tauri::State;

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct TipRecipient {
    id: String,
    name: String,
}

#[tauri::command]
pub async fn list_tip_recipients(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<TipRecipient>, String> {
    crate::rbac::require_any(&actor_role, &TIP_WRITERS)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    sqlx::query_as(
        "SELECT id, name FROM users WHERE tenant_id = ? AND is_active = 1
         AND role IN ('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN') ORDER BY name, id",
    )
    .bind(tenant)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}
