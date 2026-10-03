use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::rules::validate_time;
use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;

// ---------------------------------------------------------------------------
// ÖĞLE / AKŞAM MENÜ PENCERELERİ
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ServiceWindow {
    pub id: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub is_active: bool,
    /// Bu pencerede satışa açık ürün sayısı.
    pub product_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceWindowInput {
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub is_active: Option<bool>,
}

pub async fn upsert_service_window(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: ServiceWindowInput,
) -> Result<ServiceWindow, String> {
    let name = input.name.trim().to_uppercase();
    if name.is_empty() {
        return Err("VALIDATION: menü penceresi adı boş olamaz".into());
    }
    validate_time(&input.start_time)?;
    validate_time(&input.end_time)?;
    if input.end_time <= input.start_time {
        return Err("VALIDATION: menü penceresi bitişi başlangıçtan sonra olmalı".into());
    }
    let is_active = input.is_active.unwrap_or(true);

    // Pencere adı doğal anahtardır: aynı adlı iki pencere olursa hangisinin
    // geçerli olduğu belirsizleşir. Mevcut kayıt varsa güncellenir.
    let mevcut: Option<String> =
        sqlx::query_scalar("SELECT id FROM menu_service_windows WHERE tenant_id = ? AND name = ?")
            .bind(tenant_id)
            .bind(&name)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    let id = match mevcut {
        Some(id) => {
            sqlx::query(
                "UPDATE menu_service_windows
                    SET start_time = ?, end_time = ?, is_active = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(&input.start_time)
            .bind(&input.end_time)
            .bind(is_active)
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let id = generate_id("msw");
            sqlx::query(
                "INSERT INTO menu_service_windows
                     (id, tenant_id, name, start_time, end_time, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(&name)
            .bind(&input.start_time)
            .bind(&input.end_time)
            .bind(is_active)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };

    let product_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM menu_window_products WHERE tenant_id = ? AND window_id = ?",
    )
    .bind(tenant_id)
    .bind(&id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ServiceWindow {
        id,
        name,
        start_time: input.start_time,
        end_time: input.end_time,
        is_active,
        product_count,
    })
}

pub async fn list_service_windows(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<ServiceWindow>, String> {
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.start_time, w.end_time, w.is_active,
                (SELECT COUNT(*) FROM menu_window_products m
                  WHERE m.tenant_id = w.tenant_id AND m.window_id = w.id) AS product_count
           FROM menu_service_windows w
          WHERE w.tenant_id = ?
          ORDER BY start_time ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(ServiceWindow {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            start_time: row.try_get("start_time").map_err(|e| e.to_string())?,
            end_time: row.try_get("end_time").map_err(|e| e.to_string())?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
            product_count: row.try_get("product_count").map_err(|e| e.to_string())?,
        });
    }
    Ok(result)
}

/// Verilen ürünü menü penceresine ekler veya çıkarır.
pub async fn set_window_product(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    window_id: &str,
    product_id: &str,
    is_available: bool,
) -> Result<(), String> {
    ensure_owned(conn, "menu_service_windows", window_id, tenant_id).await?;
    ensure_owned(conn, "products", product_id, tenant_id).await?;

    sqlx::query(
        "INSERT INTO menu_window_products (id, tenant_id, window_id, product_id, is_available)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, window_id, product_id)
         DO UPDATE SET is_available = excluded.is_available",
    )
    .bind(generate_id("mwp"))
    .bind(tenant_id)
    .bind(window_id)
    .bind(product_id)
    .bind(is_available)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// O an geçerli menü penceresinin adı. `None` = kısıt yok (tüm gün satış).
pub(super) async fn active_service_window(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    now_time: &str,
) -> Result<Option<String>, String> {
    let rows = sqlx::query(
        "SELECT name, start_time, end_time FROM menu_service_windows
          WHERE tenant_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for row in rows {
        let name: String = row.try_get("name").map_err(|e| e.to_string())?;
        let start: String = row.try_get("start_time").map_err(|e| e.to_string())?;
        let end: String = row.try_get("end_time").map_err(|e| e.to_string())?;
        let uygun = if end > start {
            now_time >= start.as_str() && now_time < end.as_str()
        } else {
            now_time >= start.as_str() || now_time < end.as_str()
        };
        if uygun {
            return Ok(Some(name));
        }
    }
    Ok(None)
}
