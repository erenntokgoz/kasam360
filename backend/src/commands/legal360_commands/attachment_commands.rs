//! Yasal kayıtlara dosya eki.
//!
//! Neden veritabanında: dosya klasörde dursaydı yedeğe ve diğer cihazlara gitmezdi.
//! Eşitleme günlüğünü şişirmesin diye boyut sınırı dardır; ruhsat taraması buna sığar.

use serde::Serialize;
use sqlx::Row;
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant};
use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::lan_sync::WritePool;

/// Base64 uzunluğu: yaklaşık 1,5 MB dosya.
const MAX_CONTENT_CHARS: usize = 2_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub owner_id: String,
    pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFile {
    pub file_name: String,
    pub mime_type: String,
    pub content_base64: String,
}

pub(crate) fn validate(file_name: &str, content_base64: &str) -> Result<(), String> {
    if file_name.trim().is_empty() {
        return Err("VALIDATION: dosya adı zorunludur.".to_string());
    }
    if content_base64.is_empty() {
        return Err("VALIDATION: dosya boş.".to_string());
    }
    if content_base64.len() > MAX_CONTENT_CHARS {
        return Err("VALIDATION: dosya 1,5 MB sınırını aşıyor.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_legal_attachments(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<AttachmentInfo>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    let rows = sqlx::query("SELECT owner_id, file_name FROM legal_attachments WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_all(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            Ok(AttachmentInfo {
                owner_id: row.try_get("owner_id").map_err(|e| e.to_string())?,
                file_name: row.try_get("file_name").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn get_legal_attachment(
    actor_role: String,
    tenant_id: Option<String>,
    owner_id: String,
    pool: State<'_, DbPool>,
) -> Result<AttachmentFile, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = acquire(&pool).await?;
    let row = sqlx::query(
        "SELECT file_name, mime_type, content_base64 FROM legal_attachments
         WHERE tenant_id = ? AND owner_id = ?",
    )
    .bind(&tenant_id)
    .bind(&owner_id)
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: dosya bulunamadı".to_string())?;
    Ok(AttachmentFile {
        file_name: row.try_get("file_name").map_err(|e| e.to_string())?,
        mime_type: row.try_get("mime_type").map_err(|e| e.to_string())?,
        content_base64: row.try_get("content_base64").map_err(|e| e.to_string())?,
    })
}

/// Aynı kayda yeni dosya eskisinin yerine geçer: yenilenen ruhsatın tek güncel belgesi olur.
#[tauri::command]
pub async fn save_legal_attachment(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    owner_id: String,
    file_name: String,
    mime_type: String,
    content_base64: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    validate(&file_name, &content_base64)?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.begin_write().await?;
    sqlx::query(
        "INSERT INTO legal_attachments (id, tenant_id, owner_id, file_name, mime_type, content_base64)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, owner_id) DO UPDATE SET
             file_name = excluded.file_name,
             mime_type = excluded.mime_type,
             content_base64 = excluded.content_base64",
    )
    .bind(generate_id("att"))
    .bind(&tenant_id)
    .bind(&owner_id)
    .bind(&file_name)
    .bind(&mime_type)
    .bind(&content_base64)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    record_audit(
        &mut conn,
        &lock,
        &tenant_id,
        &actor_id,
        &actor_role,
        category::FINANS,
        "yasal:dosya_eklendi",
        &owner_id,
        serde_json::json!({ "fileName": file_name }),
    )
    .await?;
    conn.commit().await
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn bos_ve_buyuk_dosya_reddedilir() {
        assert!(validate("ruhsat.pdf", "QUJD").is_ok());
        assert!(validate(" ", "QUJD").is_err());
        assert!(validate("ruhsat.pdf", "").is_err());
        assert!(validate("ruhsat.pdf", &"A".repeat(2_000_001)).is_err());
    }
}
