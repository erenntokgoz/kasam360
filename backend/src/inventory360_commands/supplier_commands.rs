//! Tedarikçi kataloğu ve satın alma komutları (Spec §2.10).
//!
//! Rol kapısı: `OWNER` yazar, `MANAGER` okur. Tedarikçi fiyatı doğrudan maliyeti
//! etkiler; `MANAGER` fiyat göremez çünkü satın alma kararı sahibindir.
//!
//! Sipariş teslimi FIFO partisi açar ve stok kolonunu artırır. Bu yüzden teslim
//! komutu `BEGIN IMMEDIATE` ile sarılır ve denetim defterine alınan maliyet
//! yazılır.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::suppliers;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetSupplierProductArgs {
    pub supplier_id: String,
    pub product_id: String,
    pub unit_cost_cents: i64,
    pub min_order_quantity: Option<f64>,
    pub pack_size: Option<String>,
    pub is_preferred: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompareSupplierPricesArgs {
    pub product_id: String,
    pub annual_volume: Option<f64>,
}

#[tauri::command]
pub async fn get_inventory_suppliers(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<suppliers::Supplier>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    suppliers::list_suppliers(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn upsert_supplier_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: suppliers::SupplierInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<suppliers::Supplier, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let kaydedilen_ad = args.name.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<suppliers::Supplier, String> = async {
        let tedarikci = suppliers::upsert_supplier(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "tedarikci:saved",
            &tedarikci.id,
            serde_json::json!({ "name": kaydedilen_ad }),
        )
        .await?;

        Ok(tedarikci)
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
pub async fn set_supplier_product_command(
    actor_role: String,
    tenant_id: Option<String>,
    args: SetSupplierProductArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(None, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        suppliers::set_supplier_product(
            &mut conn,
            &tenant_id,
            suppliers::SupplierProductInput {
                supplier_id: args.supplier_id.clone(),
                product_id: args.product_id.clone(),
                unit_cost_cents: args.unit_cost_cents,
                min_order_quantity: args.min_order_quantity,
                pack_size: args.pack_size.clone(),
                is_preferred: args.is_preferred,
            },
        )
        .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "tedarikci:price_set",
            &args.product_id,
            serde_json::json!({
                "supplierId": args.supplier_id,
                "unitCostCents": args.unit_cost_cents,
            }),
        )
        .await?;

        Ok(())
    }
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
pub async fn compare_supplier_prices_command(
    actor_role: String,
    tenant_id: Option<String>,
    args: CompareSupplierPricesArgs,
    pool: State<'_, DbPool>,
) -> Result<suppliers::PriceGap, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    suppliers::compare_supplier_prices(&mut conn, &tenant_id, &args.product_id, args.annual_volume)
        .await
}

#[tauri::command]
pub async fn create_purchase_order_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: suppliers::PurchaseOrderInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<suppliers::PurchaseOrder, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let siparis_no = args.order_number.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<suppliers::PurchaseOrder, String> = async {
        let siparis =
            suppliers::create_purchase_order(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "satinalma:order_created",
            &siparis.id,
            serde_json::json!({
                "orderNumber": siparis_no,
                "totalCents": siparis.total_cents,
            }),
        )
        .await?;

        Ok(siparis)
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
pub async fn receive_purchase_order_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    order_id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<i64, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<i64, String> = async {
        let alinan_maliyet =
            suppliers::receive_purchase_order(&mut conn, &tenant_id, &order_id).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "satinalma:order_received",
            &order_id,
            serde_json::json!({ "receivedCostCents": alinan_maliyet }),
        )
        .await?;

        Ok(alinan_maliyet)
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
