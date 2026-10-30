//! İlk kurulum komutları.
//!
//! Bu komutlar oturumsuz çalışır: henüz kullanıcı yoktur. Bu yüzden her biri
//! `PENDING` durumunu kendi içinde doğrular; kurulum bitince hiçbiri iş yapmaz.

use crate::db::DbPool;
use crate::services::lan_sync::runtime::sync_port;
use crate::services::lan_sync::WritePool;
use crate::services::setup::{self, NewBusinessInput, SetupDraft, SetupState};

#[tauri::command]
pub async fn get_setup_status(pool: tauri::State<'_, DbPool>) -> Result<SetupState, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    setup::load_state(&mut conn).await
}

#[tauri::command]
pub async fn save_setup_draft(
    mode: Option<String>,
    draft: SetupDraft,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    setup::save_draft(&mut conn, mode.as_deref(), &draft).await
}

#[tauri::command]
pub async fn complete_business_setup(
    payload: NewBusinessInput,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    setup::validate_owner_pin(&payload.pin, &payload.pin_confirm)?;
    crate::services::device_session::validate_password(&payload.password)?;
    // Argon2 yazma kilidi alınmadan önce hesaplanır.
    let pin_hash = crate::user_credentials::hash_pin(&payload.pin)?;
    let credential_hash = crate::auth::hash_credential(&payload.password)?;

    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    setup::complete_new_business(&mut tx, &audit_lock, &payload, &pin_hash, &credential_hash)
        .await?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// Kurulmamış cihazı tek kullanımlık kodla mevcut işletmeye katar.
///
/// Kurulum katılım transaction'ı içinde kapanır. Hata olursa cihaz `PENDING`
/// kalır ve yeni kodla yeniden denenebilir.
#[tauri::command]
pub async fn join_existing_business(
    code: String,
    device_name: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        if setup::load_state(&mut conn).await?.status != "PENDING" {
            return Err("CONFLICT: bu cihazda kayıtlı işletme var".to_string());
        }
    }
    let name = device_name.trim();
    if name.is_empty() {
        return Err("VALIDATION: cihaz adı zorunludur".to_string());
    }
    state
        .lan_sync
        .join(&code, setup::PROVISIONAL_TENANT, name, sync_port())
        .await
}
