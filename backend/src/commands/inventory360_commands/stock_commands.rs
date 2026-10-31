//! Stok partilerini yalnız işletme sahibi maliyetiyle görebilir.

use tauri::State;

use super::{acquire, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::inventory360::stock::{list_stock_batches, StockBatch};
use crate::services::stock_trail::{self, StockTrailRow};

#[tauri::command]
pub async fn list_stock_batches_command(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<StockBatch>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    list_stock_batches(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn get_stock_trail(
    actor_role: String,
    tenant_id: Option<String>,
    product_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<StockTrailRow>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    stock_trail::list(&mut conn, &tenant_id, product_id.as_deref()).await
}
