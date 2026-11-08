//! Birleşmenin geri sarılmış günlüğe karşı korunması ve denetim alt zincirinin taşınması.
//!
//! Yedekten dönen cihaz, kümenin daha önce birleştirdiği cihaz sırasını farklı kimlikle
//! yeniden getirebilir. Böyle bir birleşme her cihazda aynı biçimde reddedilir; kabul
//! edilseydi aynı satış iki kez sayılır ya da kaybolan kayıt gizlenirdi.

use super::capture;
use super::island_queue::{IslandBatch, IslandEntry, ISLAND_AUDIT};
use crate::services::cari::ApplyError;
use serde_json::Value;
use sqlx::SqliteConnection;

/// Geri sarılmış günlük: aynı cihaz sırası farklı kimlikle ya da eksik zincirle gelir.
pub(super) async fn reject_rollback(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    batch: &IslandBatch,
) -> Result<(), ApplyError> {
    for entry in &batch.entries {
        let merged: Option<String> = sqlx::query_scalar(
            "SELECT island_operation_id FROM merged_island_ops
             WHERE tenant_id = ? AND device_id = ? AND device_sequence = ?",
        )
        .bind(tenant_id)
        .bind(&batch.device_id)
        .bind(entry.device_sequence)
        .fetch_optional(&mut *conn)
        .await?;
        if merged.is_some_and(|id| id != entry.operation_id) {
            return Err(ApplyError::Rejected(format!(
                "ROLLED_BACK: {} cihazının ada günlüğü geri sarılmış (sıra {})",
                batch.device_id, entry.device_sequence
            )));
        }
    }
    Ok(())
}

/// Ada denetim satırlarını olduğu gibi taşır; işlem reddedilse bile zincir kopmaz.
pub(super) async fn carry_audit(
    conn: &mut SqliteConnection,
    batch: &IslandBatch,
    entry: &IslandEntry,
) -> Result<(), ApplyError> {
    for change in entry.changes.iter().filter(|c| c.table == ISLAND_AUDIT) {
        let Some(row) = change.row.as_ref() else {
            continue;
        };
        let sequence = row.get("device_sequence").and_then(Value::as_i64);
        let id = row.get("id").and_then(Value::as_str);
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM audit_island_ledger WHERE device_id = ? AND device_sequence = ?",
        )
        .bind(&batch.device_id)
        .bind(sequence)
        .fetch_optional(&mut *conn)
        .await?;
        match existing {
            Some(found) if Some(found.as_str()) == id => continue,
            Some(_) => {
                return Err(ApplyError::Rejected(format!(
                    "ROLLED_BACK: {} cihazının denetim alt zinciri farklı",
                    batch.device_id
                )))
            }
            None => {}
        }
        if let Err(error) = capture::apply_one(conn, change).await {
            return Err(if error.contains("INTEGRITY VIOLATION") {
                ApplyError::Rejected(format!("ROLLED_BACK: alt zincir eksik: {error}"))
            } else {
                ApplyError::Internal(error)
            });
        }
    }
    Ok(())
}
