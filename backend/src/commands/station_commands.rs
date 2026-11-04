//! İstasyon tanımları: menü kategorisi istasyona, istasyon yazıcıya ve görevlilere bağlanır.

use sqlx::Row;
use tauri::State;

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::rbac::{self, Role};
use crate::services::lan_sync::WritePool;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    id: String,
    name: String,
    printer_name: Option<String>,
    user_ids: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationInput {
    id: Option<String>,
    name: String,
    printer_name: Option<String>,
    user_ids: Vec<String>,
}

#[tauri::command]
pub async fn get_station_settings(
    tenant_id: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<Station>, String> {
    let rows = sqlx::query(
        "SELECT id, name, printer_name, user_ids FROM stations
          WHERE tenant_id = ? ORDER BY created_at, name",
    )
    .bind(&tenant_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            let users: String = row.try_get("user_ids").map_err(|e| e.to_string())?;
            Ok(Station {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                name: row.try_get("name").map_err(|e| e.to_string())?,
                printer_name: row.try_get("printer_name").map_err(|e| e.to_string())?,
                user_ids: users
                    .split(',')
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
                    .collect(),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn save_station(
    actor_role: String,
    tenant_id: String,
    input: StationInput,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: istasyon adı boş olamaz".into());
    }
    let users = input.user_ids.join(",");
    let mut conn = pool.begin_write().await?;
    let id = match input.id {
        Some(id) => {
            sqlx::query(
                "UPDATE stations SET name = ?, printer_name = ?, user_ids = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(name)
            .bind(&input.printer_name)
            .bind(&users)
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let id = generate_id("stn");
            sqlx::query(
                "INSERT INTO stations (id, tenant_id, name, printer_name, user_ids)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&tenant_id)
            .bind(name)
            .bind(&input.printer_name)
            .bind(&users)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };
    conn.commit().await?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_station(
    actor_role: String,
    tenant_id: String,
    station_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = pool.begin_write().await?;
    sqlx::query("DELETE FROM stations WHERE id = ? AND tenant_id = ?")
        .bind(&station_id)
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    conn.commit().await?;
    Ok(())
}

/// Windows'a kurulu yazıcılar. Liste alınamazsa hata yukarı taşınır, boş yazıcı gösterilmez.
#[tauri::command]
pub async fn list_printers() -> Result<Vec<String>, String> {
    let output = tokio::task::spawn_blocking(|| {
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-Printer | Select-Object -ExpandProperty Name",
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Yazıcı listesi alınamadı.".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect())
}
