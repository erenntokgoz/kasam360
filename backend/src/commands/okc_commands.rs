//! Yazar kasa (YN ÖKC) ayar ve durum komutları.
//!
//! Ayar yalnız OWNER tarafından değiştirilir. Kasiyer kalıcı uyarıları görür:
//! fişsiz kalan tahsilat denemesi toast ile kaybolmaz.

use tauri::State;

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::lan_sync::WritePool;
use crate::services::okc::gate::{DeviceConnector, SystemConnector};
use crate::services::okc::receipt_log::{self, ReceiptRow};
use crate::services::okc::settings::{self, OkcSettings};

const READERS: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkcConnectionStatus {
    pub connected: bool,
    pub code: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn get_okc_settings(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<OkcSettings, String> {
    rbac::require_any(&actor_role, &READERS)?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    settings::load(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn set_okc_settings(
    actor_role: String,
    tenant_id: Option<String>,
    settings: OkcSettings,
    pool: State<'_, DbPool>,
) -> Result<OkcSettings, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut tx = pool.begin_write().await?;
    settings::save(&mut tx, &tenant_id, &settings).await?;
    tx.commit().await?;
    Ok(settings)
}

/// Kalıcı uyarı listesi: yazar kasa fişi kesilemediği için tamamlanamayan tahsilatlar.
#[tauri::command]
pub async fn list_okc_failures(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<ReceiptRow>, String> {
    rbac::require_any(&actor_role, &READERS)?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    receipt_log::list_open_failures(&mut conn, &tenant_id).await
}

/// Bağlantı denemesi: cihaza bağlanır, eşleşmeyi ve anahtar kontrolünü yoklar.
/// Fiş kesmez. Sonuç hata olsa bile komut başarılı döner; durum alanı taşır.
#[tauri::command]
pub async fn test_okc_connection(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<OkcConnectionStatus, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let configured = settings::load(&mut conn, &tenant_id).await?;
    drop(conn);
    if !configured.enabled {
        return Ok(OkcConnectionStatus {
            connected: false,
            code: None,
            message: "Yazar kasa kapalı.".to_string(),
        });
    }
    configured.validate().map_err(|e| e.to_command_error())?;
    let outcome = tokio::task::spawn_blocking(move || {
        SystemConnector
            .connect(&configured)
            .and_then(|mut client| client.echo())
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(match outcome {
        Ok(()) => OkcConnectionStatus {
            connected: true,
            code: None,
            message: "Yazar kasa bağlı ve eşleşmiş.".to_string(),
        },
        Err(error) => OkcConnectionStatus {
            connected: false,
            code: Some(error.code().to_string()),
            message: error.to_string(),
        },
    })
}
