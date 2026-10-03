//! Yasal belge komutları (CRUD + hatırlatma takvimi).
//!
//! Rol kapısı: `OWNER` ve `MANAGER` okur, yalnız `OWNER` yazar.
//!
//! Neden müdür okur ama yazamaz: ruhsat, HACCP ve SGK kaydı denetim
//! belgesidir; müdür belgeyi güncel tutmak zorundadır ve eksik belgeyi
//! fark etmesi müdürün işidir. Yazma yetkisi sahibe tanımlıdır çünkü belge
//! kaydı işletmenin resmî beyanıdır ve imza sahibinin kararıdır.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_FINANS};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::legal::{
    get_expiring_documents, list_documents, list_upcoming_reminders, save_document, LegalDocument,
    LegalDocumentInput,
};

#[tauri::command]
pub async fn list_documents_command(
    actor_role: String,
    tenant_id: Option<String>,
    doc_type: Option<String>,
    only_active: Option<bool>,
    pool: State<'_, DbPool>,
) -> Result<Vec<LegalDocument>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_documents(
        &mut conn,
        &tenant_id,
        doc_type.as_deref(),
        only_active.unwrap_or(true),
    )
    .await
}

/// Yaklaşan hatırlatmalar. Varsayılan pencere 30 gündür; belge kendi
/// `reminder_days` değerine göre listede yer alır.
#[tauri::command]
pub async fn list_upcoming_reminders_command(
    actor_role: String,
    tenant_id: Option<String>,
    window_days: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<LegalDocument>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_upcoming_reminders(&mut conn, &tenant_id, window_days.unwrap_or(30)).await
}

#[tauri::command]
pub async fn get_expiring_documents_command(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<LegalDocument>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    get_expiring_documents(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn save_legal_document_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: LegalDocumentInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<LegalDocument, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<LegalDocument, String> = async {
        let belge = save_document(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            "yasal:belge_saved",
            &belge.id,
            serde_json::json!({
                "docType": belge.doc_type,
                "expiryDate": belge.expiry_date,
                "isActive": belge.is_active,
            }),
        )
        .await?;

        Ok(belge)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}
