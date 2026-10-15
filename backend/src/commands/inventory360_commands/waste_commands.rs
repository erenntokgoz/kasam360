//! Fire ve kör sayım komutları (Spec §2.12).
//!
//! Fire kaydı ve sayım kapatma mali etkilidir: stok partilerini düşürür,
//! maliyet yazar ve denetim defterine girer. Bu yüzden her yazma komutu
//! `BEGIN IMMEDIATE` ile sarılır ve `audit_mutex` altında çalışır.
//!
//! Rol kapısı: yalnız `OWNER`. `MANAGER` vardiyayı kapatabilir ama fireyi
//! `OWNER` onayı olmadan giremez; fire doğrudan zarar kalemi oluşturur.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::waste;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenStockCountArgs {
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordCountLineArgs {
    pub stock_count_id: String,
    pub product_id: String,
    pub counted_quantity: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseStockCountArgs {
    pub stock_count_id: String,
    pub apply_adjustment: bool,
}

#[tauri::command]
pub async fn open_stock_count_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: OpenStockCountArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<waste::StockCount, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<waste::StockCount, String> = async {
        let sayim = waste::open_stock_count(
            &mut conn,
            &tenant_id,
            &actor_id,
            args.location.clone(),
            args.notes.clone(),
        )
        .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "stok:count_opened",
            &sayim.id,
            serde_json::json!({ "location": args.location }),
        )
        .await?;

        Ok(sayim)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

#[tauri::command]
pub async fn record_count_line_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: RecordCountLineArgs,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, _) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = waste::record_count_line(
        &mut conn,
        &tenant_id,
        &args.stock_count_id,
        &args.product_id,
        args.counted_quantity,
        &actor_id,
    )
    .await;

    match result {
        Ok(()) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

#[tauri::command]
pub async fn close_stock_count_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: CloseStockCountArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<waste::StockCount, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<waste::StockCount, String> = async {
        let sayim = waste::close_stock_count(
            &mut conn,
            &tenant_id,
            &args.stock_count_id,
            &actor_id,
            args.apply_adjustment,
        )
        .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "stok:count_closed",
            &sayim.id,
            serde_json::json!({
                "applyAdjustment": args.apply_adjustment,
                "lineCount": sayim.lines.len(),
            }),
        )
        .await?;

        Ok(sayim)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

#[tauri::command]
pub async fn get_stock_count_command(
    actor_role: String,
    tenant_id: Option<String>,
    stock_count_id: String,
    pool: State<'_, DbPool>,
) -> Result<waste::StockCount, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    waste::get_stock_count(&mut conn, &tenant_id, &stock_count_id).await
}

#[tauri::command]
pub async fn list_stock_counts_command(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<waste::StockCount>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    waste::list_stock_counts(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn record_waste_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: waste::WasteInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<waste::WasteRecord, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<waste::WasteRecord, String> = async {
        let kayit = waste::record_waste(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "stok:waste_recorded",
            &kayit.id,
            serde_json::json!({
                "productId": kayit.product_id,
                "reason": kayit.reason,
                "quantity": kayit.quantity,
                "totalCostCents": kayit.total_cost_cents,
            }),
        )
        .await?;

        Ok(kayit)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

#[tauri::command]
pub async fn list_waste_records_command(
    actor_role: String,
    tenant_id: Option<String>,
    limit: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<waste::WasteRecord>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    waste::list_waste_records(&mut conn, &tenant_id, limit).await
}
