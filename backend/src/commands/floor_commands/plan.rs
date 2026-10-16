//! Salon planı sorgu ve veri yapıları.
//!
//! Neden ayrı modül: `floor_commands.rs` 500 satır tavanını aştığı için
//! plan DTO'su ve salon sorgusu bu alt modüle ayrıldı.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FloorPlanData {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(rename = "openedAt")]
    pub opened_at: Option<String>,
    #[serde(rename = "waiterId")]
    pub waiter_id: Option<String>,
    /// Masa için tamsayı kuruş cinsinden yürüyen toplam. 0 aktif sipariş olmadığını belirtir.
    #[serde(rename = "currentTotal")]
    pub current_total: i64,
    pub zone: Option<String>,
    pub seats: i64,
    #[serde(rename = "waiterName")]
    pub waiter_name: Option<String>,
    #[serde(rename = "guestCount")]
    pub guest_count: Option<i64>,
    #[serde(rename = "readyItemCount")]
    pub ready_item_count: i64,
    #[serde(rename = "idleMinutes")]
    pub idle_minutes: Option<i64>,
    #[serde(rename = "reservationCustomerName")]
    pub reservation_customer_name: Option<String>,
    #[serde(rename = "reservationTime")]
    pub reservation_time: Option<String>,
}

#[tauri::command]
pub async fn get_floor_plan(
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<FloorPlanData>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let query = r#"
        SELECT 
            t.id, 
            t.name, 
            t.status, 
            t.opened_at, 
            t.waiter_id, 
            t.current_total,
            t.zone,
            t.seats,
            u.name AS waiter_name,
            o_agg.guest_count,
            COALESCE(o_agg.ready_item_count, 0) AS ready_item_count,
            CASE 
                WHEN t.opened_at IS NOT NULL OR o_agg.last_activity IS NOT NULL THEN
                    MAX(0, CAST((strftime('%s', 'now') - strftime('%s', COALESCE(o_agg.last_activity, t.opened_at))) / 60 AS INTEGER))
                ELSE NULL
            END AS idle_minutes,
            res.customer_name AS reservation_customer_name,
            res.reserved_at AS reservation_time
        FROM tables t
        LEFT JOIN users u ON u.id = t.waiter_id AND u.tenant_id = t.tenant_id
        LEFT JOIN (
            SELECT 
                o.table_id,
                SUM(o.guest_count) AS guest_count,
                MAX(o.updated_at) AS last_activity,
                SUM(CASE WHEN UPPER(oi.status) = 'READY' THEN 1 ELSE 0 END) AS ready_item_count
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
            WHERE o.tenant_id = ? AND o.status IN ('OPEN', 'IN_PROGRESS')
            GROUP BY o.table_id
        ) o_agg ON o_agg.table_id = t.id
        LEFT JOIN (
            SELECT table_id, customer_name, reserved_at
            FROM reservations
            WHERE tenant_id = ? AND status = 'ACTIVE'
            GROUP BY table_id
        ) res ON res.table_id = t.id
        WHERE t.tenant_id = ?
        ORDER BY t.name ASC
    "#;

    let rows = sqlx::query(query)
        .bind(&tenant_id)
        .bind(&tenant_id)
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut res = Vec::with_capacity(rows.len());
    for row in rows {
        res.push(FloorPlanData {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            status: row
                .try_get("status")
                .unwrap_or_else(|_| "AVAILABLE".to_string()),
            opened_at: row.try_get("opened_at").ok(),
            waiter_id: row.try_get("waiter_id").ok(),
            current_total: row
                .try_get::<i64, _>("current_total")
                .map_err(|e| e.to_string())?,
            zone: row.try_get("zone").ok(),
            seats: row.try_get::<i64, _>("seats").unwrap_or(4),
            waiter_name: row.try_get("waiter_name").ok(),
            guest_count: row.try_get::<Option<i64>, _>("guest_count").ok().flatten(),
            ready_item_count: row.try_get::<i64, _>("ready_item_count").unwrap_or(0),
            idle_minutes: row.try_get::<Option<i64>, _>("idle_minutes").ok().flatten(),
            reservation_customer_name: row.try_get("reservation_customer_name").ok(),
            reservation_time: row.try_get("reservation_time").ok(),
        });
    }
    Ok(res)
}
