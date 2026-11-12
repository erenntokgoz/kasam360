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
#[cfg(all(debug_assertions, any(target_os = "android", target_os = "ios")))]
pub(crate) const API_URL: &str = match option_env!("KASAM360_DEV_API_URL") {
    Some(url) => url,
    None => "https://api.kasam360.com.tr",
};
#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
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

/// Uygulama içi Google penceresinin etiketi; aynı anda tek giriş penceresi açık kalır.
const GOOGLE_WINDOW: &str = "google-login";
/// Giriş bitince site bu adrese yönlenir; pencere bunu yakalayıp kendini kapatır (adres açılmaz).
const GOOGLE_DONE_SCHEME: &str = "kasam360";

/// Google girişini masaüstünde uygulama penceresinde açar. Pencerede Tauri IPC yetkisi yoktur
/// (yetki yalnız `main` penceresine tanımlıdır); uzak sayfa uygulamanın komutlarını çağıramaz.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_google_window(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(existing) = app.get_webview_window(GOOGLE_WINDOW) {
        existing.close().map_err(|error| error.to_string())?;
    }
    let target: tauri::Url = url
        .parse()
        .map_err(|_| "Giriş adresi geçersiz.".to_string())?;
    let handle = app.clone();
    WebviewWindowBuilder::new(app, GOOGLE_WINDOW, WebviewUrl::External(target))
        .title("Google ile giriş")
        .inner_size(480.0, 720.0)
        .center()
        .on_navigation(move |next| {
            // Site "giriş tamam" der demez pencere kapanır; oturum uygulamadaki yoklamayla aktarılır.
            if next.scheme() == GOOGLE_DONE_SCHEME {
                let closing = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(window) = closing.get_webview_window(GOOGLE_WINDOW) {
                        let _ = window.close();
                    }
                });
                return false;
            }
            // Yalnız güvenli bağlantılar açılır; dosya ve özel şema yönlendirmeleri engellenir.
            next.scheme() == "https" || (cfg!(debug_assertions) && next.scheme() == "http")
        })
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Giriş tamamlanınca ya da vazgeçilince uygulamadaki yoklama pencereyi kapatır.
#[tauri::command]
pub fn close_google_login(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window(GOOGLE_WINDOW) {
            window.close().map_err(|error| error.to_string())?;
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    Ok(())
}

/// Google girişi masaüstünde uygulama penceresinde, mobilde uygulama içi sekmede açılır; yasal
/// metinler sistem tarayıcısındadır. Mobilde sekmeyi arayüz açar (`in_app`), bu yüzden adres döner.
#[tauri::command]
pub fn open_site_page(
    app: tauri::AppHandle,
    path: String,
    in_app: Option<bool>,
) -> Result<String, String> {
    let url = site_page_url(&path)?;
    let is_google = path.ends_with("/google");
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        if is_google && in_app.unwrap_or(false) {
            return Ok(url);
        }
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|error| error.to_string())?;
        Ok(url)
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = in_app;
        if is_google {
            open_google_window(&app, &url)?;
            return Ok(url);
        }
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| url)
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
    // Kasa tek işletmenin yerel verisini taşır. Başka bir hesap bu kasada hesabı olmadığı için
    // "hatalı şifre" gibi görünen genel hata yerine gerçek neden söylenir; yerel kullanıcı
    // aranmadan parola doğrulaması başlatılmaz (kaba kuvvet kilidi de gereksiz yere dolmaz).
    let known: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE is_active = 1
         AND (email = ? COLLATE NOCASE OR login_identifier = ? COLLATE NOCASE)",
    )
    .bind(&email)
    .bind(&email)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if known == 0 {
        let waiting = other_business_note(&mut conn).await?;
        return Err(format!(
            "OTHER_BUSINESS: Bu kasada başka bir işletme kayıtlı ve {email} onun hesabı değil. Başka hesapla girmek için önce kayıtlı hesapla girip Ayarlar > Oturum bölümünden çıkış yapın; işlemler buluta gidince kasa temizlenir.{waiting}"
        ));
    }
    drop(conn);
    let user = authenticate_by_identifier(&pool, &email, &password).await?;
    crate::rbac::require_any(&user.role, &ACCOUNT_ROLES)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    device_session::sign_in(&mut conn, &user.id, &user.tenant_id).await?;
    device_session::load(&mut conn).await
}

/// Çıkışı yarım kalmış kasada kullanıcıya bekleyen işlem sayısını söyler; veri sayımı diskten gelir.
async fn other_business_note(conn: &mut sqlx::SqliteConnection) -> Result<String, String> {
    use crate::services::cloud_sync::state;
    let stored = state::load(conn).await?;
    if !stored.wipe_pending {
        return Ok(String::new());
    }
    let pending = match state::identity(conn).await? {
        Some(identity) => state::pending_count(conn, &identity).await?,
        None => 0,
    };
    Ok(format!(
        " Çıkış bekliyor: {pending} işlem buluta henüz gitmedi, bu yüzden yerel veri silinmedi."
    ))
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
