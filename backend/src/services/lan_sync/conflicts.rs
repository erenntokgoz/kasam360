//! Birleşme çakışmalarının yönetici kuyruğu.
//!
//! Çakışma otomatik çözülmez: çift tahsilat iade akışıyla, stok sayımla düzeltilir.
//! Kapatma yalnız kararın kaydıdır; iki tarafın satırına dokunmaz, notla birlikte
//! eşitlenen yazma yolundan geçer ve denetime yazılır.

use super::write_tx::WritePool;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub id: String,
    pub kind: String,
    pub device_id: String,
    pub island_operation_id: String,
    pub target_table: String,
    pub target_id: String,
    pub details: Value,
    pub status: String,
    pub created_at: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
    pub resolution_note: Option<String>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Kiracının çakışmaları; bekleyenler önce, yeniden eskiye.
pub async fn list(
    pool: &SqlitePool,
    tenant_id: &str,
    pending_only: bool,
) -> Result<Vec<SyncConflict>, String> {
    let rows = sqlx::query(
        "SELECT id, kind, device_id, island_operation_id, target_table, target_id, details,
                status, created_at, resolved_by, resolved_at, resolution_note
         FROM merge_conflicts
         WHERE tenant_id = ? AND (? = 0 OR status = 'PENDING')
         ORDER BY status = 'PENDING' DESC, created_at DESC, id DESC",
    )
    .bind(tenant_id)
    .bind(i64::from(pending_only))
    .fetch_all(pool)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            let details: String = row.try_get("details").map_err(text_error)?;
            Ok(SyncConflict {
                id: row.try_get("id").map_err(text_error)?,
                kind: row.try_get("kind").map_err(text_error)?,
                device_id: row.try_get("device_id").map_err(text_error)?,
                island_operation_id: row.try_get("island_operation_id").map_err(text_error)?,
                target_table: row.try_get("target_table").map_err(text_error)?,
                target_id: row.try_get("target_id").map_err(text_error)?,
                details: serde_json::from_str(&details).map_err(|e| e.to_string())?,
                status: row.try_get("status").map_err(text_error)?,
                created_at: row.try_get("created_at").map_err(text_error)?,
                resolved_by: row.try_get("resolved_by").map_err(text_error)?,
                resolved_at: row.try_get("resolved_at").map_err(text_error)?,
                resolution_note: row.try_get("resolution_note").map_err(text_error)?,
            })
        })
        .collect()
}

/// Çakışmayı notla kapatır.
pub async fn resolve(
    pool: &SqlitePool,
    audit: &Mutex<()>,
    tenant_id: &str,
    conflict_id: &str,
    actor_id: &str,
    actor_role: &str,
    note: &str,
) -> Result<(), String> {
    let note = note.trim();
    if note.is_empty() {
        return Err("VALIDATION: çözüm notu zorunludur".to_string());
    }
    let lock = AuditLock::new(audit.lock().await);
    let mut tx = pool.begin_write().await?;
    let now = chrono::Utc::now().to_rfc3339();
    let updated = sqlx::query(
        "UPDATE merge_conflicts
         SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, resolution_note = ?
         WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(actor_id)
    .bind(&now)
    .bind(note)
    .bind(conflict_id)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(text_error)?;
    if updated.rows_affected() != 1 {
        return Err("NOT_FOUND: bekleyen çakışma bulunamadı".to_string());
    }
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::GUVENLIK,
        "sync:conflict_resolved",
        conflict_id.to_string(),
        serde_json::json!({ "note": note }),
        now,
    )?;
    AuditService::append(&mut tx, &lock, &ctx).await?;
    tx.commit().await
}
