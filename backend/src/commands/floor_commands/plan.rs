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
    pub x: i64,
    pub y: i64,
    #[serde(rename = "reservationId")]
    pub reservation_id: Option<String>,
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
    #[serde(rename = "reservationPartySize")]
    pub reservation_party_size: Option<i64>,
    #[serde(rename = "activeOrderId")]
    pub active_order_id: Option<String>,
    /// Masanın ödenmemiş tutarı; parça ödeme sonrası adisyon toplamından küçüktür.
    #[serde(rename = "remainingCents")]
    pub remaining_cents: Option<i64>,
    pub trail: Option<String>,
    pub merged: Option<String>,
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
            t.trail,
            t.merged,
            t.zone,
            t.seats,
            t.x,
            t.y,
            u.name AS waiter_name,
            o_agg.guest_count,
            COALESCE(o_agg.ready_item_count, 0) AS ready_item_count,
            CASE 
                WHEN t.opened_at IS NOT NULL OR o_agg.last_activity IS NOT NULL THEN
                    MAX(0, CAST((strftime('%s', 'now') - strftime('%s', COALESCE(o_agg.last_activity, t.opened_at))) / 60 AS INTEGER))
                ELSE NULL
            END AS idle_minutes,
            res.id AS reservation_id,
            res.customer_name AS reservation_customer_name,
            res.reserved_at AS reservation_time,
            res.party_size AS reservation_party_size
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
            SELECT id, table_id, customer_name, reserved_at, party_size
            FROM reservations
            WHERE tenant_id = ? AND status = 'ACTIVE'
            GROUP BY table_id
        ) res ON res.table_id = t.id
        WHERE t.tenant_id = ? AND substr(t.id, 1, 12) != 'tbl_counter_'
        ORDER BY t.name ASC
    "#;

    let rows = sqlx::query(query)
        .bind(&tenant_id)
        .bind(&tenant_id)
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let lead_minutes =
        crate::services::reservation_service::lead::lead_minutes(&mut conn, &tenant_id).await?;
    let now = chrono::Utc::now();
    let open_orders: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT table_id, id, bill_requested_at FROM orders
         WHERE tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND table_id IS NOT NULL
         ORDER BY created_at ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut open_by_table: std::collections::HashMap<String, (String, i64, bool)> =
        std::collections::HashMap::new();
    for (table_id, order_id, bill_requested_at) in open_orders {
        let balance =
            crate::services::order_settlement::order_balance(&mut conn, &tenant_id, &order_id)
                .await?;
        let entry = open_by_table
            .entry(table_id)
            .or_insert((String::new(), 0, false));
        entry.0 = order_id;
        entry.1 += balance.remaining_cents;
        entry.2 |= bill_requested_at.is_some();
    }
    let mut res = Vec::with_capacity(rows.len());
    for row in rows {
        let stored_status: String = row
            .try_get("status")
            .unwrap_or_else(|_| "AVAILABLE".to_string());
        let reservation_time: Option<String> = row.try_get("reservation_time").ok();
        let table_id: String = row.try_get("id").unwrap_or_default();
        let open_order = open_by_table.remove(&table_id);
        let bill_asked = open_order.as_ref().is_some_and(|order| order.2);
        res.push(FloorPlanData {
            id: table_id,
            name: row.try_get("name").unwrap_or_default(),
            status: if stored_status == "OCCUPIED" && bill_asked {
                "BILL_REQUESTED".to_string()
            } else {
                crate::services::reservation_service::lead::displayed_status(
                    &stored_status,
                    reservation_time.as_deref(),
                    now,
                    lead_minutes,
                )
            },
            opened_at: row.try_get("opened_at").ok(),
            waiter_id: row.try_get("waiter_id").ok(),
            current_total: row
                .try_get::<i64, _>("current_total")
                .map_err(|e| e.to_string())?,
            zone: row.try_get("zone").ok(),
            seats: row.try_get::<i64, _>("seats").unwrap_or(4),
            x: row.try_get::<i64, _>("x").map_err(|e| e.to_string())?,
            y: row.try_get::<i64, _>("y").map_err(|e| e.to_string())?,
            reservation_id: row.try_get("reservation_id").ok(),
            waiter_name: row.try_get("waiter_name").ok(),
            guest_count: row.try_get::<Option<i64>, _>("guest_count").ok().flatten(),
            ready_item_count: row.try_get::<i64, _>("ready_item_count").unwrap_or(0),
            idle_minutes: row.try_get::<Option<i64>, _>("idle_minutes").ok().flatten(),
            reservation_customer_name: row.try_get("reservation_customer_name").ok(),
            reservation_time,
            reservation_party_size: row
                .try_get::<Option<i64>, _>("reservation_party_size")
                .ok()
                .flatten(),
            active_order_id: open_order.as_ref().map(|order| order.0.clone()),
            remaining_cents: open_order.map(|order| order.1),
            trail: row.try_get("trail").map_err(|e| e.to_string())?,
            merged: row.try_get("merged").map_err(|e| e.to_string())?,
        });
    }
    Ok(res)
}
