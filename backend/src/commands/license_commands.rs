//! Cihaz lisansı: hesapla bağlama, sunucudan yenileme ve saklanan belgenin durumu.
//!
//! Komutlar personel oturumu istemez: lisans yokken kasa açılmaz ve bağlamayı sahip
//! web hesabıyla yapar. Ağ yalnız sabit site adresine gider; IPC'den adres gelmez.

use crate::commands::account_commands::SITE_URL;
use crate::db::DbPool;
use crate::services::license::{self, LicenseStatus};
use serde::Deserialize;

fn client() -> Result<reqwest::Client, String> {
    // Sağlayıcı açılışta kurulur; testten ya da başka girişten çağrılırsa burada da kurulur.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "Bağlantı hazırlanamadı.".to_string())
}

#[derive(Deserialize)]
struct Message {
    message: Option<String>,
    device: Option<String>,
}

#[derive(Deserialize)]
struct Issued {
    token: String,
}

const OFFLINE: &str = "Lisans sunucusuna ulaşılamadı. Kasa son geçerli belgeyle çalışır.";

async fn current(pool: &DbPool) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    Ok(license::status(&stored, chrono::Utc::now()))
}

/// Saklanan belgenin durumu; ağa çıkmaz.
#[tauri::command]
pub async fn get_license_status(pool: tauri::State<'_, DbPool>) -> Result<LicenseStatus, String> {
    current(&pool).await
}

/// Sunucudan yeni belge ister. Ağ hatası eldeki belgeyi silmez; sunucunun açık reddi siler.
#[tauri::command]
pub async fn refresh_license(pool: tauri::State<'_, DbPool>) -> Result<LicenseStatus, String> {
    refresh(&pool).await
}

async fn refresh(pool: &DbPool) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    drop(conn);
    let Some(key) = stored.license_key.clone() else {
        return current(pool).await;
    };
    let response = client()?
        .get(format!("{SITE_URL}/api/desktop/license"))
        .bearer_auth(&key)
        .header("x-device-id", &stored.device_id)
        .header("x-device-name", device_name())
        .send()
        .await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let Ok(response) = response else {
        license::record(&mut conn, None, false, false, Some(OFFLINE)).await?;
        return current(pool).await;
    };
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    match status {
        200 => {
            let issued: Issued =
                serde_json::from_str(&body).map_err(|_| "Sunucu yanıtı okunamadı.".to_string())?;
            let claims = license::verify(&issued.token)?;
            if claims.device_id != stored.device_id {
                return Err("Lisans belgesi bu cihaza ait değil.".to_string());
            }
            license::record(&mut conn, Some(&issued.token), false, false, None).await?;
        }
        401 => {
            // Anahtar iptal edilmiş ya da hesap silinmiş: cihaz yeniden bağlanmalı.
            let message = "Lisans anahtarı geçersiz. Cihazı işletme hesabıyla yeniden bağlayın.";
            license::record(&mut conn, None, true, true, Some(message)).await?;
        }
        403 => {
            let reply: Option<Message> = serde_json::from_str(&body).ok();
            let message = reply
                .as_ref()
                .and_then(|m| m.message.clone())
                .unwrap_or_else(|| "Lisans verilmedi.".to_string());
            // Cihaz limit dışı, kaldırılmış veya paketsizse eski belge de geçersiz sayılır.
            let denied = reply.as_ref().is_some_and(|m| m.device.is_some());
            license::record(&mut conn, None, denied, false, Some(&message)).await?;
        }
        _ => {
            license::record(&mut conn, None, false, false, Some(OFFLINE)).await?;
        }
    }
    drop(conn);
    current(pool).await
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.chars().filter(|c| !c.is_control()).take(80).collect())
        .unwrap_or_else(|| "Kasa".to_string())
}

/// Sahip web hesabının e-posta ve şifresiyle bağlar. Şifre saklanmaz, yalnız anahtar saklanır.
#[tauri::command]
pub async fn link_license(
    email: String,
    password: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<LicenseStatus, String> {
    let body = serde_json::json!({ "email": email.trim(), "password": password }).to_string();
    let response = client()?
        .post(format!("{SITE_URL}/api/desktop/license-key"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.".to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if status != 201 {
        let message = serde_json::from_str::<Message>(&text)
            .ok()
            .and_then(|m| m.message)
            .unwrap_or_else(|| "Cihaz bağlanamadı.".to_string());
        return Err(message);
    }
    let key = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.get("key")?.as_str().map(str::to_string))
        .ok_or_else(|| "Sunucu yanıtı okunamadı.".to_string())?;
    store_and_refresh(&pool, &key).await
}

/// Google girişi tarayıcıda biter; tek kullanımlık kodun sonucu lisans anahtarını taşır.
#[tauri::command]
pub async fn link_license_with_google(
    code: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<LicenseStatus, String> {
    if code.len() != 36 || !code.chars().all(|c| c == '-' || c.is_ascii_hexdigit()) {
        return Err("Bağlantı kodu geçersiz.".to_string());
    }
    let response = client()?
        .get(format!("{SITE_URL}/api/desktop-link/{code}"))
        .send()
        .await
        .map_err(|_| "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.".to_string())?;
    if response.status().as_u16() != 200 {
        return Err("LINK_PENDING: Google girişi henüz tamamlanmadı.".to_string());
    }
    let text = response.text().await.unwrap_or_default();
    let key = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.get("licenseKey")?.as_str().map(str::to_string))
        .ok_or_else(|| "Bu Google hesabının e-postası doğrulanmamış.".to_string())?;
    store_and_refresh(&pool, &key).await
}

async fn store_and_refresh(pool: &DbPool, key: &str) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    license::load(&mut conn).await?;
    license::save_key(&mut conn, key).await?;
    drop(conn);
    refresh(pool).await
}
