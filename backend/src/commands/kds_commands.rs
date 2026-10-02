//! KDS komutları (bilet geçişleri, aktif biletler)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TicketStatusTransitionDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "itemId")]
    pub item_id: Option<String>,
    #[serde(rename = "fromStatus")]
    pub from_status: String,
    #[serde(rename = "toStatus")]
    pub to_status: String,
    pub timestamp: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
}

#[tauri::command]
pub async fn kds_update_ticket_status(
    payload: TicketStatusTransitionDto,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let event_id = format!("evt_kds_{}", Uuid::new_v4());
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let order_info = sqlx::query("SELECT tenant_id, table_id FROM orders WHERE id = ?")
        .bind(&payload.order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let tenant_id = order_info.as_ref()
        .and_then(|r| r.try_get::<String, _>("tenant_id").ok())
        .unwrap_or_else(|| "DEFAULT_TENANT".to_string());

    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'KDS_TICKET', 'TICKET_STATUS_UPDATED', ?, datetime('now'))"
    )
    .bind(&event_id)
    .bind(&tenant_id)
    .bind(&payload.order_id)
    .bind(&payload_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let outbox_id = format!("outbox_{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))"
    )
    .bind(&outbox_id)
    .bind(&tenant_id)
    .bind(&event_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Sipariş güncellenme zaman damgasını yenile
    sqlx::query("UPDATE orders SET updated_at = datetime('now') WHERE id = ?")
        .bind(&payload.order_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let to_upper = payload.to_status.to_uppercase();
    if to_upper == "PREPARING" {
        sqlx::query("UPDATE order_items SET status = 'Preparing' WHERE order_id = ? AND (status = 'Pending' OR status = 'PENDING')")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else if to_upper == "READY" {
        sqlx::query("UPDATE order_items SET status = 'Ready' WHERE order_id = ? AND UPPER(status) NOT IN ('COMPLETED', 'SERVED')")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else if to_upper == "COMPLETED" || to_upper == "SERVED" {
        sqlx::query("UPDATE order_items SET status = 'Completed' WHERE order_id = ?")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // KDS durum geçişi de bir operasyonel değişikliktir: mutfak ekranındaki her
    // ilerleme "Sipariş & Masa" kategorisine yazılır. İstemci tarafında ikinci bir
    // ledger bulunmadığından bu kayıt tek gerçek kaynaktır.
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        payload.actor_role.clone(),
        crate::services::audit_service::category::SIPARIS_MASA,
        "kds:ticket_status_advanced",
        payload.order_id.clone(),
        serde_json::json!({
            "fromStatus": payload.from_status,
            "toStatus": payload.to_status,
            "eventId": event_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct KdsOrderDto {
    pub id: String,
    #[serde(rename = "orderNumber")]
    pub order_number: String,
    #[serde(rename = "tableNumber")]
    pub table_number: Option<String>,
    pub status: String,
    pub items: Vec<serde_json::Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub priority: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn get_active_tickets(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<KdsOrderDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query("
        SELECT o.id, t.name as table_name, o.created_at, o.notes
        FROM orders o
        LEFT JOIN tables t ON o.table_id = t.id
        WHERE o.status = 'IN_PROGRESS' AND (o.tenant_id = ? OR o.tenant_id = 'DEFAULT_TENANT')
        ORDER BY o.created_at ASC
    ")
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for r in rows {
        let id: String = r.try_get("id").unwrap_or_default();

        let item_rows = sqlx::query("
            SELECT oi.id, oi.quantity, COALESCE(p.name, 'Ürün') as product_name, oi.station, oi.modifiers, oi.notes, oi.status
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        ")
        .bind(&id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        if item_rows.is_empty() {
            continue;
        }

        let mut items = Vec::new();
        let mut all_completed = true;
        let mut all_ready = true;
        let mut any_preparing = false;

        for ir in item_rows {
            let product_name: String = ir.try_get("product_name").unwrap_or_default();
            let quantity: i64 = ir.try_get("quantity").unwrap_or(0);
            let station: Option<String> = ir.try_get("station").ok();
            let resolved_station = station.unwrap_or_else(|| "Sıcak".to_string());
            let modifiers_str: Option<String> = ir.try_get("modifiers").ok();
            let notes: Option<String> = ir.try_get("notes").ok();
            let status: String = ir.try_get("status").unwrap_or_else(|_| "Pending".to_string());

            let st_upper = status.to_uppercase();
            if st_upper != "COMPLETED" && st_upper != "SERVED" && st_upper != "CANCELLED" {
                all_completed = false;
            }
            if st_upper != "READY" && st_upper != "COMPLETED" && st_upper != "SERVED" {
                all_ready = false;
            }
            if st_upper == "PREPARING" || st_upper == "IN_PROGRESS" {
                any_preparing = true;
            }

            let modifiers: Vec<String> = if let Some(m) = modifiers_str {
                serde_json::from_str(&m).unwrap_or_default()
            } else {
                Vec::new()
            };

            items.push(serde_json::json!({
                "id": ir.try_get::<String, _>("id").unwrap_or_default(),
                "orderId": id.clone(),
                "name": product_name,
                "quantity": quantity,
                "station": resolved_station.clone(),
                "stationId": resolved_station,
                "status": status,
                "modifiers": modifiers,
                "notes": notes
            }));
        }

        if all_completed {
            continue;
        }

        let final_status = if all_ready {
            "Ready".to_string()
        } else if any_preparing {
            "Preparing".to_string()
        } else {
            "Pending".to_string()
        };

        let created_at_str: String = r.try_get("created_at").unwrap_or_default();
        let priority = if let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(&created_at_str) {
            let elapsed = chrono::Utc::now().signed_duration_since(created_at.with_timezone(&chrono::Utc));
            if elapsed.num_minutes() >= 15 {
                "RUSH".to_string()
            } else {
                "NORMAL".to_string()
            }
        } else {
            "NORMAL".to_string()
        };

        res.push(KdsOrderDto {
            id: id.clone(),
            order_number: format!("ORD-{}", id.chars().take(4).collect::<String>().to_uppercase()),
            table_number: r.try_get("table_name").ok(),
            status: final_status,
            items,
            created_at: created_at_str,
            priority,
            notes: r.try_get("notes").ok(),
        });
    }

    Ok(res)
}
