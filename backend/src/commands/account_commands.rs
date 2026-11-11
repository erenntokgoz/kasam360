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
// Mobil debug sürümü de açıkça dev URL verilmedikçe gerçek TLS alan adını kullanır.
#[cfg(all(debug_assertions, any(target_os = "android", target_os = "ios")))]
pub(crate) const SITE_URL: &str = match option_env!("KASAM360_DEV_SITE_URL") {
    Some(url) => url,
    None => "https://kasam360.com.tr",
};
#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
pub(crate) const SITE_URL: &str = match option_env!("KASAM360_DEV_SITE_URL") {
    Some(url) => url,
    None => "http://localhost:3000",
};
#[cfg(not(debug_assertions))]
pub(crate) const SITE_URL: &str = "https://kasam360.com.tr";

// Sunucu çağrıları (lisans, eşitleme, menü yayını) üretimde API alt alanına gider; TLS doğrulaması
// kapatılmaz. Geliştirmede site adresi (web vekili) veya açık dev adresi kullanılır.
#[cfg(debug_assertions)]
pub(crate) const API_URL: &str = match option_env!("KASAM360_DEV_API_URL") {
    Some(url) => url,
    None => SITE_URL,
};
#[cfg(not(debug_assertions))]
pub(crate) const API_URL: &str = "https://api.kasam360.com.tr";

/// Tarayıcıya yalnız bilinen sayfalar gider; IPC'den gelen metin komut satırına ulaşamaz.
fn site_page_url(path: &str) -> Result<String, String> {
    let is_link_code = path
        .strip_prefix("/api/desktop-link/")
        .and_then(|rest| rest.strip_suffix("/google"))
        .is_some_and(|code| {
            code.len() == 36 && code.chars().all(|c| c == '-' || c.is_ascii_hexdigit())
        });
    if is_link_code || matches!(path, "/kvkk" | "/kullanim-sartlari") {
        return Ok(format!("{SITE_URL}{path}"));
    }
    Err("Bu sayfa açılamaz.".to_string())
}

/// Google girişi ve yasal metinler sistem tarayıcısında açılır.
#[tauri::command]
pub fn open_site_page(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let url = site_page_url(&path)?;
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

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

/// Google ile açılmış hesabın cihaz girişi. Kimlik uygulamaya değil sunucuya sorulur:
/// tarayıcıda Google girişi biten tek kullanımlık kodun hesabı siteden okunur ve
/// yalnız bu cihazda kayıtlı sahip ya da müdür e-postasıyla eşleşirse oturum açılır.
#[tauri::command]
pub async fn account_sign_in_link(
    code: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DeviceSession, String> {
    let path = format!("/api/desktop-link/{code}/google");
    // Kod biçimi `site_page_url` ile aynı kuralla denetlenir; serbest metin adrese gitmez.
    site_page_url(&path)?;
    // Sağlayıcı açılışta kurulur; testten ya da başka girişten çağrılırsa burada da kurulur.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "Bağlantı hazırlanamadı.".to_string())?;
    let response = client
        .get(format!("{SITE_URL}/api/desktop-link/{code}"))
        .send()
        .await
        .map_err(|_| "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.".to_string())?;
    if response.status().as_u16() != 200 {
        return Err("LINK_PENDING: Google girişi henüz tamamlanmadı.".to_string());
    }
    let body = response
        .text()
        .await
        .map_err(|_| "Sunucu yanıtı okunamadı.".to_string())?;
    let account: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "Sunucu yanıtı okunamadı.".to_string())?;
    let email = account
        .get("email")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Sunucu yanıtında e-posta yok.".to_string())?;
    let email = device_session::normalize_email(email)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query(
        "SELECT id, tenant_id, role FROM users
         WHERE email = ? COLLATE NOCASE AND is_active = 1",
    )
    .bind(&email)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| {
        format!(
            "{email} bu cihazdaki işletmenin sahip ya da müdür hesabı değil. İşletmenin kayıtlı e-postasıyla girin."
        )
    })?;
    use sqlx::Row;
    let user_id: String = row.try_get("id").map_err(|e| e.to_string())?;
    let tenant_id: String = row.try_get("tenant_id").map_err(|e| e.to_string())?;
    let role: String = row.try_get("role").map_err(|e| e.to_string())?;
    crate::rbac::require_any(&role, &ACCOUNT_ROLES)?;
    device_session::sign_in(&mut conn, &user_id, &tenant_id).await?;
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
    sign_out_device(&pool, &state, actor_id, actor_role, tenant_id).await
}

/// Hesap oturumunu kapatır ve denetime yazar. Bulut çıkışı da bunu kullanır: çıkış kaydı
/// günlüğe girer ve yerel veri silinmeden önce buluta ulaşır.
pub(crate) async fn sign_out_device(
    pool: &DbPool,
    state: &crate::AppState,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
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
    state.staff_session.clear()?;
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

#[cfg(test)]
mod tests {
    use super::site_page_url;

    #[test]
    fn site_sayfasi_yalniz_bilinen_yollari_acar() {
        assert!(site_page_url("/kvkk").is_ok_and(|url| url.ends_with("/kvkk")));
        assert!(site_page_url("/kvkk & calc").is_err());
        assert!(
            site_page_url("/api/desktop-link/11111111-2222-3333-4444-555555555555/google").is_ok()
        );
        assert!(
            site_page_url("/api/desktop-link/11111111&calc-3333-4444-555555555555/google").is_err()
        );
    }
}
