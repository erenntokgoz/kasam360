//! Cihazın işletme hesabı oturumu: e-posta ve şifreyle giriş, çıkış, oturum ayarı.
//!
//! Personel girişi (`auth_login`) bu oturum açılmadan çalışmaz. Komutlar bu yüzden
//! personel oturumu istemez; ayar ve çıkış ise açık bir personel rolü ister.

use crate::commands::auth_commands::{authenticate_by_identifier, authenticate_by_pin};
use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::device_session::{self, DeviceSession};
use crate::services::lan_sync::WritePool;
use crate::services::setup;

const ACCOUNT_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

#[tauri::command]
pub async fn get_device_session(pool: tauri::State<'_, DbPool>) -> Result<DeviceSession, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    device_session::load(&mut conn).await
}

/// Hesap doğrulanır, personel oturumu açılmaz: kasada kimin çalıştığını PIN söyler.
#[tauri::command]
pub async fn account_sign_in(
    email: String,
    password: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DeviceSession, String> {
    let email = device_session::normalize_email(&email)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if setup::load_state(&mut conn).await?.status != "COMPLETE" {
        return Err(
            "ACCOUNT_NOT_ON_DEVICE: bu cihazda işletme yok. Kayıt olun veya cihazı bağlayın."
                .to_string(),
        );
    }
    drop(conn);
    let user = authenticate_by_identifier(&pool, &email, &password).await?;
    crate::rbac::require_any(&user.role, &ACCOUNT_ROLES)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    device_session::sign_in(&mut conn, &user.id, &user.tenant_id).await?;
    device_session::load(&mut conn).await
}

/// Eski işletme sahibine hesap açar. Kimliği sahip PIN'i kanıtlar.
#[tauri::command]
pub async fn account_create(
    email: String,
    password: String,
    owner_pin: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeviceSession, String> {
    state.lan_sync.require_local_write()?;
    setup::require_complete(&pool).await?;
    let email = device_session::normalize_email(&email)?;
    device_session::validate_password(&password)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if !device_session::load(&mut conn).await?.account_missing {
        return Err("CONFLICT: işletme hesabı zaten var".to_string());
    }
    drop(conn);
    let owner = authenticate_by_pin(&pool, &owner_pin, None).await?;
    crate::rbac::require_any(&owner.role, &[Role::Owner])?;
    // Argon2 yazma kilidi alınmadan önce hesaplanır.
    let credential_hash = crate::auth::hash_credential(&password)?;

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE users SET email = ?, login_identifier = ?, credential_hash = ?
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&email)
    .bind(&email)
    .bind(&credential_hash)
    .bind(&owner.id)
    .bind(&owner.tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    device_session::sign_in(&mut tx, &owner.id, &owner.tenant_id).await?;
    let ctx = AuditContext::new(
        owner.tenant_id.clone(),
        owner.id.clone(),
        owner.role.clone(),
        category::GUVENLIK,
        "account:created",
        owner.id.clone(),
        serde_json::json!({ "userId": owner.id }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    let session = device_session::load(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}

/// Cihazı işletme hesabından çıkarır; sonraki kullanım e-posta ve şifre ister.
#[tauri::command]
pub async fn account_sign_out(
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeviceSession, String> {
    crate::rbac::require_any(&actor_role, &ACCOUNT_ROLES)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    device_session::sign_out(&mut tx).await?;
    let ctx = AuditContext::new(
        tenant_id.clone(),
        actor_id,
        actor_role,
        category::GUVENLIK,
        "account:signed_out",
        tenant_id,
        serde_json::json!({}),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    let session = device_session::load(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}

/// Bu cihazın oturum ayarı. Cihaza özeldir, diğer cihazları değiştirmez.
#[tauri::command]
pub async fn set_session_policy(
    keep_signed_in: bool,
    staff_idle_seconds: i64,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeviceSession, String> {
    crate::rbac::require_any(&actor_role, &ACCOUNT_ROLES)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    device_session::set_policy(&mut tx, keep_signed_in, staff_idle_seconds).await?;
    let ctx = AuditContext::new(
        tenant_id.clone(),
        actor_id,
        actor_role,
        category::GUVENLIK,
        "session:policy_changed",
        tenant_id,
        serde_json::json!({ "keepSignedIn": keep_signed_in, "staffIdleSeconds": staff_idle_seconds }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    let session = device_session::load(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(session)
}
