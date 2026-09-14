use crate::db::DbPool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModifierOptionDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "priceCents")]
    pub price_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModifierGroupDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "isRequired")]
    pub is_required: bool,
    #[serde(rename = "minSelections")]
    pub min_selections: i64,
    #[serde(rename = "maxSelections")]
    pub max_selections: Option<i64>,
    pub options: Vec<ModifierOptionDto>,
}

#[tauri::command]
pub async fn get_product_modifiers(
    product_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ModifierGroupDto>, String> {
    let groups_query = "
        SELECT mg.id, mg.name, mg.is_required, mg.min_selections, mg.max_selections 
        FROM modifier_groups mg
        JOIN product_modifier_groups pmg ON mg.id = pmg.group_id
        WHERE pmg.product_id = ?
    ";
    
    let groups_rows = sqlx::query_as::<_, (String, String, bool, i64, Option<i64>)>(groups_query)
        .bind(&product_id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();

    for (id, name, is_required, min_selections, max_selections) in groups_rows {
        let options_query = "
            SELECT id, name, price_cents
            FROM modifier_options
            WHERE group_id = ?
        ";
        
        let options_rows = sqlx::query_as::<_, (String, String, i64)>(options_query)
            .bind(&id)
            .fetch_all(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        let options = options_rows.into_iter().map(|(o_id, o_name, o_price)| {
            ModifierOptionDto {
                id: o_id,
                name: o_name,
                price_cents: o_price,
            }
        }).collect();

        result.push(ModifierGroupDto {
            id,
            name,
            is_required,
            min_selections,
            max_selections,
            options,
        });
    }

    Ok(result)
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
