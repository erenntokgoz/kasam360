use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StationDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn get_stations(pool: tauri::State<'_, DbPool>) -> Result<Vec<StationDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut rows = sqlx::query("SELECT id, name, description FROM stations ORDER BY name ASC")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // Veritabanı boşsa varsayılan mutfak istasyonlarını tohumla (Sıcak, Soğuk, İçecek, Izgara, Tatlı)
    if rows.is_empty() {
        let default_stations = vec![
            ("st_sicak", "Sıcak", "Sıcak Mutfak ve Ana Yemekler"),
            ("st_soguk", "Soğuk", "Soğuk Mutfak, Salata ve Mezeler"),
            ("st_icecek", "İçecek", "Bar, Sıcak ve Soğuk İçecekler"),
            ("st_izgara", "Izgara", "Izgara, Döner ve Fırın"),
            ("st_tatli", "Tatlı", "Tatlılar ve Pastane"),
        ];
        for (id, name, desc) in default_stations {
            let _ = sqlx::query("INSERT OR IGNORE INTO stations (id, name, description, created_at) VALUES (?, ?, ?, datetime('now'))")
                .bind(id)
                .bind(name)
                .bind(desc)
                .execute(&mut *conn)
                .await;
        }
        rows = sqlx::query("SELECT id, name, description FROM stations ORDER BY name ASC")
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut res = Vec::new();
    for row in rows {
        res.push(StationDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            description: row.try_get("description").ok(),
        });
    }

    Ok(res)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateStationPayload {
    pub name: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn create_station(
    payload: CreateStationPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<StationDto, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let id = format!("st_{}", Uuid::new_v4());

    sqlx::query("INSERT INTO stations (id, name, description, created_at) VALUES (?, ?, ?, datetime('now'))")
        .bind(&id)
        .bind(&payload.name)
        .bind(&payload.description)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(StationDto {
        id,
        name: payload.name,
        description: payload.description,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateKdsItemStatusPayload {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub status: String,
}

#[tauri::command]
pub async fn update_kds_item_status(
    payload: UpdateKdsItemStatusPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<bool, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE order_items SET status = ? WHERE id = ?")
        .bind(&payload.status)
        .bind(&payload.item_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Siparişin updated_at alanını güncelle
    sqlx::query("UPDATE orders SET updated_at = datetime('now') WHERE id = (SELECT order_id FROM order_items WHERE id = ?)")
        .bind(&payload.item_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Kalemin ait olduğu sipariş ID'sini bul ve tüm kalemler hazırsa sipariş durumunu Ready yap
    let order_id_opt = sqlx::query_scalar::<_, String>("SELECT order_id FROM order_items WHERE id = ?")
        .bind(&payload.item_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(order_id) = order_id_opt {
        let rows = sqlx::query("SELECT status FROM order_items WHERE order_id = ?")
            .bind(&order_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        let all_ready_or_completed = !rows.is_empty() && rows.iter().all(|r| {
            let st: String = r.try_get("status").unwrap_or_default();
            let upper = st.to_uppercase();
            upper == "READY" || upper == "COMPLETED" || upper == "SERVED"
        });

        if all_ready_or_completed {
            let tenant_id = sqlx::query_scalar::<_, String>("SELECT tenant_id FROM orders WHERE id = ?")
                .bind(&order_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "DEFAULT_TENANT".to_string());

            let event_id = format!("evt_kds_{}", Uuid::new_v4());
            let ticket_event = serde_json::json!({
                "orderId": order_id,
                "fromStatus": "Preparing",
                "toStatus": "Ready",
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "actorId": "kitchen_item_progression",
                "actorRole": "Kitchen"
            });

            sqlx::query(
                "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'KDS_TICKET', 'TICKET_STATUS_UPDATED', ?, datetime('now'))"
            )
            .bind(&event_id)
            .bind(&tenant_id)
            .bind(&order_id)
            .bind(ticket_event.to_string())
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}
