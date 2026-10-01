use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::db::DbPool;

#[derive(Debug, Serialize, Deserialize)]
pub struct ApprovalDto {
    pub id: String,
    pub request_type: String,
    pub resource_id: String,
    pub requester_id: String,
    pub status: String,
    pub approver_id: Option<String>,
    pub payload: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[tauri::command]
pub async fn request_approval(
    pool: tauri::State<'_, DbPool>,
    request_type: String,
    resource_id: String,
    requester_id: String,
    payload: String,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO approvals (id, tenant_id, request_type, resource_id, requester_id, status, payload)
        VALUES (?, 'DEFAULT_TENANT', ?, ?, ?, 'PENDING', ?)
        "#,
    )
    .bind(&id)
    .bind(&request_type)
    .bind(&resource_id)
    .bind(&requester_id)
    .bind(&payload)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to create approval request: {}", e))?;

    Ok(id)
}

#[tauri::command]
pub async fn get_pending_approvals(pool: tauri::State<'_, DbPool>) -> Result<Vec<ApprovalDto>, String> {
    let rows = sqlx::query(
        r#"
        SELECT id, request_type, resource_id, requester_id, status, approver_id, payload, created_at, resolved_at
        FROM approvals
        WHERE status = 'PENDING'
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| format!("Failed to fetch pending approvals: {}", e))?;

    let mut approvals = Vec::new();
    for row in rows {
        approvals.push(ApprovalDto {
            id: row.get("id"),
            request_type: row.get("request_type"),
            resource_id: row.get("resource_id"),
            requester_id: row.get("requester_id"),
            status: row.get("status"),
            approver_id: row.get("approver_id"),
            payload: row.get("payload"),
            created_at: row.get::<String, _>("created_at"),
            resolved_at: row.get("resolved_at"),
        });
    }

    Ok(approvals)
}

#[tauri::command]
pub async fn process_approval(
    pool: tauri::State<'_, DbPool>,
    approval_id: String,
    manager_pin: String,
    action: String, // "APPROVE" or "REJECT"
) -> Result<(), String> {
    // Validate Manager PIN — düz metin PIN sütunu kaldırıldığı için `WHERE pin = ?`
    // yerine tenant kapsamındaki adaylar Argon2 ile doğrulanır.
    let mut conn = pool.acquire().await.map_err(|e| format!("Database error while checking PIN: {}", e))?;
    let found = crate::user_credentials::find_user_by_pin(&mut conn, &manager_pin, None)
        .await
        .map_err(|e| format!("Database error while checking PIN: {}", e))?;
    drop(conn);

    let found = found.ok_or_else(|| "Invalid PIN".to_string())?;
    let role: String = found.role.clone();
    let approver_id: String = found.id.clone();

    let role = crate::rbac::canonical_role(&role)
        .ok_or_else(|| "Insufficient permissions. Manager PIN required.".to_string())?;
    if !matches!(role, crate::rbac::Role::Manager | crate::rbac::Role::Owner | crate::rbac::Role::Master) {
        return Err("Insufficient permissions. Manager PIN required.".to_string());
    }

    let status = if action == "APPROVE" {
        "APPROVED"
    } else if action == "REJECT" {
        "REJECTED"
    } else {
        return Err("Invalid action".to_string());
    };

    let updated = sqlx::query(
        r#"
        UPDATE approvals
        SET status = ?, approver_id = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING'
        "#,
    )
    .bind(status)
    .bind(approver_id)
    .bind(&approval_id)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to update approval status: {}", e))?;

    if updated.rows_affected() == 0 {
        return Err("Approval not found or already processed".to_string());
    }

    Ok(())
}
