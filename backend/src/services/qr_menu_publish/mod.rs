//! Menüyü buluta yayınlama (`docs/contracts/qr-menu.md`, `kasam360.qrmenu.v1`).
//!
//! Masaüstü local-first kalır: yayın ayrı bir eylemdir, satış yolu buna hiç bağlanmaz.
//! İnternet yoksa yalnız yayın hata verir; yerel menü ve satış etkilenmez.

pub mod client;
pub mod snapshot;

use crate::db::DbPool;
use crate::services::cloud_sync::api::Credentials;
use crate::services::cloud_sync::state;
use client::{user_message, QrMenuClient};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutcome {
    pub version: i64,
    pub changed: bool,
    pub slug: Option<String>,
    pub public_path: Option<String>,
    pub uploaded_images: usize,
    /// WebP olmadığı için görselsiz yayınlanan ürün sayısı.
    pub skipped_images: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MenuStatus {
    pub slug: Option<String>,
    pub enabled: bool,
    pub entitled: bool,
    pub version: Option<i64>,
    pub published_at: Option<String>,
}

/// Lisans anahtarı ve kurulum işletmesi yoksa bulut kapalıdır. Kimlik kurulum kaydından
/// gelir; IPC'deki işletme kimliği ona uymuyorsa başka işletmeye yazılmaz.
async fn credentials_for(pool: &DbPool, tenant_id: &str) -> Result<Credentials, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let credentials = state::credentials(&mut conn).await?.ok_or_else(|| {
        "LICENSE: Bu cihaz hesaba bağlı değil; Ayarlar'dan cihaz bağlantısını tamamlayın."
            .to_string()
    })?;
    if credentials.tenant_id != tenant_id {
        return Err("FORBIDDEN: işletme kimliği bu kasayla uyuşmuyor".into());
    }
    Ok(credentials)
}

fn failure(error: &crate::services::cloud_sync::api::ApiError) -> String {
    format!("QR_MENU_{}: {}", error.code(), user_message(error))
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

pub async fn status(pool: &DbPool, base: &str, tenant_id: &str) -> Result<MenuStatus, String> {
    let credentials = credentials_for(pool, tenant_id).await?;
    let reply = QrMenuClient::new(base)?
        .status(&credentials)
        .await
        .map_err(|e| failure(&e))?;
    Ok(MenuStatus {
        slug: text(&reply, "slug"),
        enabled: reply
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        entitled: reply
            .get("entitled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        version: reply.get("version").and_then(Value::as_i64),
        published_at: text(&reply, "publishedAt"),
    })
}

/// Görselleri yükler, sonra tam anlık görüntüyü gönderir. Yükleme sırası sözleşmenin
/// gereğidir: menüdeki `imageKey` önceden yüklenmiş olmalıdır (`422 UNKNOWN_IMAGE`).
pub async fn publish(pool: &DbPool, base: &str, tenant_id: &str) -> Result<PublishOutcome, String> {
    let credentials = credentials_for(pool, tenant_id).await?;
    let built = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        snapshot::load_menu(&mut conn, tenant_id).await?
    };
    let client = QrMenuClient::new(base)?;
    for bytes in built.images.values() {
        client
            .upload_image(&credentials, bytes.clone())
            .await
            .map_err(|e| failure(&e))?;
    }
    let body = serde_json::to_string(&built.snapshot).map_err(|e| e.to_string())?;
    let reply = client
        .publish(&credentials, body)
        .await
        .map_err(|e| failure(&e))?;
    let version = reply
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "QR_MENU_BAD_REPLY: Sunucu yanıtı okunamadı.".to_string())?;
    Ok(PublishOutcome {
        version,
        changed: reply
            .get("changed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        slug: text(&reply, "slug"),
        public_path: text(&reply, "publicPath"),
        uploaded_images: built.images.len(),
        skipped_images: built.skipped_images,
    })
}
