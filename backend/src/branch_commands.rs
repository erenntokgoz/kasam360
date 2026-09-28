use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BranchDto {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub address: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_branches(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<BranchDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT id, tenant_id, name, address, status, created_at 
         FROM branches 
         WHERE tenant_id = ?"
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut branches = Vec::new();
    for row in rows {
        branches.push(BranchDto {
            id: row.try_get("id").unwrap_or_default(),
            tenant_id: row.try_get("tenant_id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            address: row.try_get("address").ok(),
            status: row.try_get("status").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
        });
    }

    Ok(branches)
}

#[tauri::command]
pub async fn create_branch(
    tenant_id: String,
    name: String,
    address: Option<String>,
    pool: tauri::State<'_, DbPool>
) -> Result<BranchDto, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let branch_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO branches (id, tenant_id, name, address, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')"
    )
    .bind(&branch_id)
    .bind(&tenant_id)
    .bind(&name)
    .bind(&address)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(BranchDto {
        id: branch_id,
        tenant_id,
        name,
        address,
        status: "ACTIVE".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
