//! POS sipariş ve adisyon sorgu komutları.
//!
//! Neden ayrı modül: pos_commands.rs 500 satır tavanını aştığı için
//! açık sipariş, kalem ve canlı sipariş sorguları bu alt modüle ayrıldı.

use crate::commands::payment_commands::CartItemDto;
use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Tezgâh satışının istemcideki sabit adı.
pub const COUNTER_TABLE: &str = "COUNTER";
/// Tezgâh satış noktasının kimlik öneki; salon planı bu satırları göstermez.
pub const COUNTER_ID_PREFIX: &str = "tbl_counter_";

/// İstemcinin masa kimliğini gerçek satış noktasına çevirir.
pub(crate) fn resolve_table_id(tenant_id: &str, table_id: &str) -> String {
    if table_id == COUNTER_TABLE {
        format!("{COUNTER_ID_PREFIX}{tenant_id}")
    } else {
        table_id.to_string()
    }
}

/// Masanın açık sipariş kimliği — adisyon fişi basımının kaynak kimliğidir.
#[tauri::command]
pub async fn get_active_order_id(
    table_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Option<String>, String> {
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let order_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM orders WHERE table_id = ? AND tenant_id = ? \
         AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(resolve_table_id(&tenant, &table_id))
    .bind(&tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(order_id)
}

#[tauri::command]
pub async fn get_order_items(
    table_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CartItemDto>, String> {
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    execute_get_order_items(&mut conn, &resolve_table_id(&tenant, &table_id), &tenant).await
}

/// Adisyonun sunucu bakiyesi; tahsilat ekranı kalan tutarı buradan gösterir.
#[tauri::command]
pub async fn get_order_balance(
    order_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<crate::services::order_settlement::OrderBalance, String> {
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::order_settlement::order_balance(&mut conn, &tenant, &order_id).await
}

pub async fn execute_get_order_items(
    conn: &mut sqlx::SqliteConnection,
    table_id: &str,
    tenant: &str,
) -> Result<Vec<CartItemDto>, String> {
    let items = sqlx::query(
        "SELECT oi.*, p.name as product_name, p.category_id as product_category_id, p.barcode as product_barcode \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id \
         JOIN products p ON oi.product_id = p.id AND p.tenant_id = oi.tenant_id \
         WHERE o.table_id = ? AND o.tenant_id = ? AND o.status IN ('OPEN', 'IN_PROGRESS') AND oi.status != 'CANCELLED' \
         ORDER BY o.created_at ASC, oi.id ASC"
    )
    .bind(table_id)
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in items {
        let modifiers_str: Option<String> = row.try_get("modifiers").ok();
        let modifiers_val: Option<serde_json::Value> =
            modifiers_str.and_then(|m| serde_json::from_str(&m).ok());

        let product_json = serde_json::json!({
            "id": row.try_get::<String, _>("product_id").map_err(|e| e.to_string())?,
            "name": row.try_get::<String, _>("product_name").map_err(|e| e.to_string())?,
            "category": row.try_get::<String, _>("product_category_id").map_err(|e| e.to_string())?,
            "categoryId": row.try_get::<String, _>("product_category_id").map_err(|e| e.to_string())?,
            "price": row.try_get::<i64, _>("unit_price_cents").map_err(|e| e.to_string())?,
            "taxRateBp": row.try_get::<i64, _>("tax_rate_bp").map_err(|e| e.to_string())?,
            "barcode": row.try_get::<Option<String>, _>("product_barcode").ok(),
            "inStock": true,
        });

        result.push(CartItemDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            product: product_json,
            quantity: row
                .try_get::<i64, _>("quantity")
                .map_err(|e| e.to_string())?,
            unit_price: row
                .try_get::<i64, _>("unit_price_cents")
                .map_err(|e| e.to_string())?,
            tax_rate: Some(
                row.try_get::<i64, _>("tax_rate_bp")
                    .map_err(|e| e.to_string())?,
            ),
            subtotal: Some(
                row.try_get::<i64, _>("subtotal_cents")
                    .map_err(|e| e.to_string())?,
            ),
            tax_amount: Some(
                row.try_get::<i64, _>("tax_amount_cents")
                    .map_err(|e| e.to_string())?,
            ),
            total: Some(
                row.try_get::<i64, _>("total_cents")
                    .map_err(|e| e.to_string())?,
            ),
            modifiers: modifiers_val,
            note: row.try_get("notes").ok(),
            discount: None,
            paid_quantity: row
                .try_get::<Option<i64>, _>("paid_quantity")
                .ok()
                .flatten(),
            is_comp: row.try_get::<i64, _>("is_comp").ok().map(|c| c != 0),
            course_number: row
                .try_get::<Option<i64>, _>("course_number")
                .ok()
                .flatten(),
            status: row.try_get::<String, _>("status").ok(),
        });
    }

    Ok(result)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LiveOrderDto {
    pub id: String,
    pub table_name: String,
    pub status: String,
    pub total_cents: i64,
    pub created_at: String,
    pub item_count: i64,
}

#[tauri::command]
pub async fn get_live_orders(
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<LiveOrderDto>, String> {
    crate::rbac::require_reporting(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "
        SELECT o.id, t.name as table_name, o.status, o.total_cents, o.created_at,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id AND tenant_id = o.tenant_id) as item_count
        FROM orders o
        JOIN tables t ON o.table_id = t.id AND t.tenant_id = o.tenant_id
        WHERE o.tenant_id = ? AND o.status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY o.created_at ASC
    ",
    )
    .bind(&tenant)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let orders = rows
        .into_iter()
        .map(|r| -> Result<LiveOrderDto, String> {
            Ok(LiveOrderDto {
                id: r.try_get("id").map_err(|e| e.to_string())?,
                table_name: r.try_get("table_name").map_err(|e| e.to_string())?,
                status: r.try_get("status").map_err(|e| e.to_string())?,
                total_cents: r.try_get("total_cents").map_err(|e| e.to_string())?,
                created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
                item_count: r.try_get("item_count").map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(orders)
}
