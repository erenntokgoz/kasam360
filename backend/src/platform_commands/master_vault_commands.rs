//! Master vault komutları (platform kasa geçiş kodu).
//!
//! Neden ayrı dosya: `platform_commands.rs` 500 satır
//! tavanını aşıyordu ve vault komutları platform
//! seviyesinde tek başına bir yüzeydir. Buradaki
//! yordamlar `tauri::State` taşır; vault doğrulama
//! kuralının kendisi `services::master_vault` içinde
//! komutsuz testlenir.
//!
//! Güvenlik kararı: vault geçiş kodu hiçbir zaman
//! düz metin olarak depolanmaz, loglanmaz veya
//! cevaba döndürülmez (AGENTS.md §3.1). Kod,
//! Argon2id hash'i olarak `master_vault` tablosunda
//! durur; repo'ya gömülü varsayılan kod yoktur.

use crate::db::DbPool;
use serde::Serialize;

use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Vault açma yanıtının taşıdığı tek alan: kapı açık mı?
///
/// Neden sadece bayrak: doğru kodla birlikte hiçbir
/// koda, hash'e veya jetona ihtiyaç kalmadan kapı
/// açılır; yanıt hiçbir gizli malzemeyi taşımaz.
#[derive(Debug, Serialize)]
pub struct VaultUnlockResultDto {
    pub unlocked: bool,
}

/// Master vault geçiş kodunu yapılandırır (yeniden üretir).
///
/// Neden MASTER kapısı: vault, platform kasa erişiminin
/// tek girişimidir. MASTER dışı hiçbir rol vault
/// kodunu değiştiremez (AGENTS.md §6).
#[tauri::command]
pub async fn master_vault_configure(
    caller_role: Option<String>,
    new_passcode: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    crate::services::master_vault::configure_passcode(&mut conn, &new_passcode).await?;

    // Kodun kendisi deftere yazılmaz; yalnızca
    // yapılandırmanın gerçekleştiği kaydedilir.
    let ctx = AuditContext::new(
        super::PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "platform:master_vault_configured",
        "master_vault".to_string(),
        serde_json::json!({ "method": "reconfigure" }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({ "success": true }))
}

/// Master vault'u açar: geçiş kodunu doğrular.
#[tauri::command]
pub async fn master_vault_unlock(
    caller_role: Option<String>,
    passcode: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<VaultUnlockResultDto, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let opened = crate::services::master_vault::unlock(&mut conn, &passcode).await?;

    let ctx = AuditContext::new(
        super::PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "platform:master_vault_unlock_attempt",
        "master_vault".to_string(),
        serde_json::json!({ "unlocked": opened }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;

    Ok(VaultUnlockResultDto { unlocked: opened })
}

/// Vault durumunu okur: yapılandırılmış mı?
///
/// Neden fail-closed: yapılandırılmadıysa vault
/// kapısıdır; bu yüzden durum sorgusu "açık mı"
/// sorusuna değil "kod belirlendi mi" sorusuna
/// cevap verir.
#[tauri::command]
pub async fn master_vault_status(
    caller_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let configured: Option<i64> = sqlx::query_scalar("SELECT 1 FROM master_vault WHERE id = 1")
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "configured": configured.is_some(),
    }))
}
