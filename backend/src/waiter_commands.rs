use crate::db::DbPool;
use serde::{Deserialize, Serialize};

pub use crate::services::modifier_service::{ModifierGroupDto, ModifierOptionDto};

/// Ürüne bağlı modifier grupları ve seçenekleri (POS seçim penceresi).
///
/// Faz 4 düzeltmesi: komut `tenant_id` ile sınırlandı. Önceden ürün `id`'si tek
/// başına yeterliydi, dolayısıyla başka işletmenin ürününe bağlı gruplar
/// okunabiliyordu; ayrıca seçenekler grup başına ayrı sorguyla (N+1) alınıyordu.
#[tauri::command]
pub async fn get_product_modifiers(
    product_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ModifierGroupDto>, String> {
    let tid = tenant_id
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::modifier_service::product_groups(&mut conn, &tid, &product_id).await
}

#[tauri::command]
pub async fn update_table_status(
    table_id: String,
    status: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    sqlx::query("UPDATE tables SET status = ? WHERE id = ?")
        .bind(status)
        .bind(table_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn waiter_clock_in(
    waiter_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<String, String> {
    let event_id = format!("evt_clockin_{}", uuid::Uuid::new_v4());
    let payload = serde_json::json!({"waiterId": waiter_id, "clockedIn": true});
    sqlx::query(
        "INSERT INTO events (event_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, 'WAITER_SHIFT', 'CLOCK_IN', ?, datetime('now'))"
    )
    .bind(&event_id)
    .bind(&waiter_id)
    .bind(serde_json::to_string(&payload).unwrap_or_default())
    .execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(event_id)
}

#[tauri::command]
pub async fn get_table_ready_status(
    table_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<String, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query("
        SELECT e.payload FROM events e
        JOIN orders o ON e.aggregate_id = o.id
        WHERE o.table_id = ? AND o.status = 'IN_PROGRESS'
        AND e.event_type = 'TICKET_STATUS_UPDATED'
        ORDER BY e.created_at DESC LIMIT 1
    ")
    .bind(&table_id)
    .fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;

    if let Some(r) = row {
        use sqlx::Row;
        let payload_str: String = r.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            return Ok(v.get("toStatus").and_then(|s| s.as_str()).unwrap_or("Unknown").to_string());
        }
    }
    Ok("Unknown".to_string())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TableReadyStatusDto {
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub status: String,
}

/// N+1 sorgu darboğazını engelleyen toplu masa KDS hazır durumu sorgusu.
#[tauri::command]
pub async fn get_all_table_statuses(
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<TableReadyStatusDto>, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT o.table_id, e.payload FROM events e
         JOIN orders o ON e.aggregate_id = o.id
         WHERE o.tenant_id = ? AND o.status = 'IN_PROGRESS'
         AND e.event_type = 'TICKET_STATUS_UPDATED'
         ORDER BY e.created_at ASC"
    )
    .bind(&tid)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::new();
    for r in rows {
        use sqlx::Row;
        let table_id: String = r.try_get("table_id").unwrap_or_default();
        let payload_str: String = r.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            let status = v.get("toStatus").and_then(|s| s.as_str()).unwrap_or("Unknown").to_string();
            map.insert(table_id, status);
        }
    }

    Ok(map.into_iter().map(|(table_id, status)| TableReadyStatusDto { table_id, status }).collect())
}

