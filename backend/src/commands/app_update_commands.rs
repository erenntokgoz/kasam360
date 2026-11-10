//! Masaüstü güncelleme komutları: sürüm, denetim ve onaylı kurulum.
//!
//! Neden elle tetiklenen kurulum: yeniden başlatma satışı keser. Arayüz yalnız haber
//! verir; indirme, imza doğrulama ve kurulum ancak yetkili kullanıcı onaylayınca ve
//! açık vardiya/sipariş yokken çalışır. İmza doğrulaması başarısızsa paket kurulmaz.

use crate::commands::command_helpers::require_tenant_id;
use crate::rbac::{require_any, Role};
use crate::services::app_update::{
    blocker_message, classify_error, count_open_work, is_pubkey_configured, UpdateCheck,
    UpdateStatus,
};
use crate::DbPool;
use tauri::State;

fn current_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_app_version(app: tauri::AppHandle) -> String {
    current_version(&app)
}

/// Yapılandırmadaki açık anahtar; boşsa güncelleme kapalıdır.
fn configured_pubkey(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .is_some_and(is_pubkey_configured)
}

/// Sunucuyu denetler. Ağ yoksa `OFFLINE` döner; hata fırlatılmaz, satış etkilenmez.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn get_app_update(app: tauri::AppHandle) -> Result<UpdateCheck, String> {
    use tauri_plugin_updater::UpdaterExt;
    let version = current_version(&app);
    if !configured_pubkey(&app) {
        return Ok(UpdateCheck::new(&version, UpdateStatus::Unconfigured));
    }
    let outcome = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    Ok(match outcome {
        Ok(Some(update)) => UpdateCheck {
            version: Some(update.version),
            notes: update.body,
            ..UpdateCheck::new(&version, UpdateStatus::Available)
        },
        Ok(None) => UpdateCheck::new(&version, UpdateStatus::UpToDate),
        Err(error) => {
            tracing::warn!("güncelleme denetimi başarısız: {error}");
            UpdateCheck {
                message: Some(error.to_string()),
                ..UpdateCheck::new(&version, classify_error(&error))
            }
        }
    })
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn get_app_update(app: tauri::AppHandle) -> Result<UpdateCheck, String> {
    Ok(UpdateCheck::new(
        &current_version(&app),
        UpdateStatus::Unconfigured,
    ))
}

/// Onaylanan sürümü indirir, imzasını doğrular, kurar ve uygulamayı yeniden başlatır.
/// Yalnız OWNER/MANAGER; açık vardiya veya sipariş varsa (veya sayılamazsa) reddedilir.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn install_app_update(
    expected_version: String,
    actor_role: String,
    tenant_id: String,
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(Some(&tenant_id))?;
    if !configured_pubkey(&app) {
        return Err("UPDATE_UNCONFIGURED: güncelleme anahtarı tanımlı değil.".to_string());
    }
    let (shifts, orders) = count_open_work(&pool, &tenant).await?;
    if let Some(message) = blocker_message(shifts, orders) {
        return Err(message);
    }
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("UPDATE_CHECK_FAILED: {error}"))?
        .ok_or_else(|| "UPDATE_NONE: güncel sürümdesiniz.".to_string())?;
    if update.version != expected_version {
        return Err(format!(
            "UPDATE_CHANGED: onaylanan sürüm {expected_version}, sunucudaki sürüm {}; yeniden denetleyin.",
            update.version
        ));
    }
    // İmza burada doğrulanır; uyuşmazsa `download_and_install` hata verir ve hiçbir şey kurulmaz.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("UPDATE_INSTALL_FAILED: {error}"))?;
    app.restart()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn install_app_update(
    _expected_version: String,
    _actor_role: String,
    _tenant_id: String,
    _pool: State<'_, DbPool>,
) -> Result<(), String> {
    Err("UPDATE_UNSUPPORTED: mobil sürüm mağaza üzerinden güncellenir.".to_string())
}
