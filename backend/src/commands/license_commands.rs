//! Cihaz lisansı: hesapla bağlama, sunucudan yenileme ve saklanan belgenin durumu.
//!
//! Komutlar personel oturumu istemez: lisans yokken kasa açılmaz ve bağlamayı sahip
//! web hesabıyla yapar. Ağ yalnız sabit site adresine gider; IPC'den adres gelmez.

use crate::commands::account_commands::API_URL;
use crate::db::DbPool;
use crate::services::license::{self, LicenseStatus, SignedTenantLicense};
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
    current_with_public_key(pool, None).await
}

async fn current_with_public_key(
    pool: &DbPool,
    verification_key: Option<&[u8]>,
) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    let mut status = license::status_with_public_key(&stored, chrono::Utc::now(), verification_key);
    drop(conn);
    if let Some(licensed_tenant) = status.tenant_id.as_deref() {
        // Kurulu kasada başka işletmenin belgesi geçersizdir. Henüz kurulmamış kasada yerel işletme
        // yoktur; seçilen işletmeye bağlanma bu belgeyle yapılır ve kurulum aynı işletmeyle tamamlanır.
        let current_tenant = local_tenant(pool).await?.map(|(tenant_id, _)| tenant_id);
        if current_tenant
            .as_deref()
            .is_some_and(|current| current != licensed_tenant)
        {
            status.state = license::LicenseState::Invalid;
            status.features.clear();
        }
    }
    Ok(status)
}

/// Saklanan belgenin durumu; ağa çıkmaz.
#[tauri::command]
pub async fn get_license_status(pool: tauri::State<'_, DbPool>) -> Result<LicenseStatus, String> {
    current(&pool).await
}

/// Sunucudan yeni belge ister. Ağ hatası eldeki belgeyi silmez; sunucunun açık reddi siler.
#[tauri::command]
pub async fn refresh_license(
    pool: tauri::State<'_, DbPool>,
    cloud: tauri::State<'_, crate::services::cloud_sync::CloudSync>,
) -> Result<LicenseStatus, String> {
    let status = refresh(&pool).await?;
    // Lisans yokken buluttan gelen ret anahtarı "reddedildi" diye işaretler ve gönderim elle
    // denenene kadar durur. Geçerli belge alınınca bekleyen kuyruk kullanıcı beklemeden gönderilir.
    if matches!(
        status.state,
        license::LicenseState::Active | license::LicenseState::Grace
    ) {
        cloud.nudge();
    }
    Ok(status)
}

async fn refresh(pool: &DbPool) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    drop(conn);
    // Anahtarsız cihaz sunucuya sormaz; önceki denemeden kalan hata bağlantı yokmuş gibi
    // görünmesin diye silinir. Ekran yalnız "bağlı değil" der ve bağlamayı ister.
    let Some(key) = stored.license_key.clone() else {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        license::record(&mut conn, None, false, false, None).await?;
        drop(conn);
        return current(pool).await;
    };
    if let Some((tenant_id, tenant_name)) = local_tenant(pool).await? {
        return refresh_tenant(pool, &stored.device_id, &key, &tenant_id, &tenant_name).await;
    }
    let response = client()?
        .get(format!("{API_URL}/api/desktop/license"))
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

async fn local_tenant(pool: &DbPool) -> Result<Option<(String, String)>, String> {
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
    let row = sqlx::query(
        "SELECT setup.tenant_id, tenant.name FROM app_setup AS setup
         JOIN tenants AS tenant ON tenant.id = setup.tenant_id
         WHERE setup.slot = 1 AND setup.status = 'COMPLETE'",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| error.to_string())?;
    row.map(|row| {
        Ok((
            sqlx::Row::try_get(&row, "tenant_id").map_err(|error| error.to_string())?,
            sqlx::Row::try_get(&row, "name").map_err(|error| error.to_string())?,
        ))
    })
    .transpose()
}

/// Kurulumdaki işletme kimliği aktivasyon isteği boyunca taşınır; V1 kayıtları silinmez.
async fn refresh_tenant(
    pool: &DbPool,
    device_id: &str,
    key: &str,
    tenant_id: &str,
    tenant_name: &str,
) -> Result<LicenseStatus, String> {
    refresh_tenant_at(pool, device_id, key, tenant_id, tenant_name, API_URL, None).await
}

async fn refresh_tenant_at(
    pool: &DbPool,
    device_id: &str,
    key: &str,
    tenant_id: &str,
    tenant_name: &str,
    base_url: &str,
    verification_key: Option<&[u8]>,
) -> Result<LicenseStatus, String> {
    let http = client()?;
    let activate = http.post(format!("{base_url}/api/desktop/tenants/{tenant_id}/activate"))
        .bearer_auth(key)
        .header("x-device-id", device_id)
        .json(&serde_json::json!({ "tenantName": tenant_name, "label": device_name(), "platform": "windows" }))
        .send().await;
    let activation = match activate {
        Ok(response) if response.status().is_success() => response,
        // Sunucu cevap verdiyse (4xx) bağlantı vardır; mesajı "ulaşılamadı" diye gizlemek sorunu saklar.
        Ok(response) if response.status().is_client_error() => {
            let text = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Message>(&text)
                .ok()
                .and_then(|item| item.message)
                .unwrap_or_else(|| "İşletme cihaz hakkı doğrulanamadı.".to_string());
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            license::record(&mut conn, None, true, false, Some(&message)).await?;
            drop(conn);
            return current_with_public_key(pool, verification_key).await;
        }
        _ => {
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            license::record(&mut conn, None, false, false, Some(OFFLINE)).await?;
            drop(conn);
            return current_with_public_key(pool, verification_key).await;
        }
    };
    let activation_body = activation.text().await.unwrap_or_default();
    let activation_value: serde_json::Value = serde_json::from_str(&activation_body)
        .map_err(|_| "Cihaz etkinleştirme yanıtı okunamadı.".to_string())?;
    if activation_value
        .get("tenantId")
        .and_then(serde_json::Value::as_str)
        != Some(tenant_id)
        || activation_value
            .get("deviceId")
            .and_then(serde_json::Value::as_str)
            != Some(device_id)
        || activation_value
            .get("status")
            .and_then(serde_json::Value::as_str)
            != Some("active")
    {
        return Err("Cihaz başka bir işletmeye bağlı veya etkin değil.".to_string());
    }
    let response = http
        .post(format!(
            "{base_url}/api/desktop/tenants/{tenant_id}/license/refresh"
        ))
        .bearer_auth(key)
        .header("x-device-id", device_id)
        .send()
        .await;
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
    let Ok(response) = response else {
        license::record(&mut conn, None, false, false, Some(OFFLINE)).await?;
        drop(conn);
        return current_with_public_key(pool, verification_key).await;
    };
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    if status == 200 {
        let signed: SignedTenantLicense =
            serde_json::from_str(&body).map_err(|_| "Lisans yanıtı okunamadı.".to_string())?;
        if signed.claims.tenant_id != tenant_id || signed.claims.device_id != device_id {
            return Err("Lisans belgesi bu işletme veya cihaza ait değil.".to_string());
        }
        license::record(&mut conn, Some(&body), false, false, None).await?;
        drop(conn);
        let result = current_with_public_key(pool, verification_key).await?;
        if result.state != license::LicenseState::Active
            || result.tenant_id.as_deref() != Some(tenant_id)
        {
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            license::record(
                &mut conn,
                None,
                true,
                false,
                Some("Lisans imzası veya kapsamı doğrulanamadı."),
            )
            .await?;
            drop(conn);
            return current_with_public_key(pool, verification_key).await;
        }
        return Ok(result);
    }
    if status == 401 || status == 403 {
        let message = serde_json::from_str::<Message>(&body)
            .ok()
            .and_then(|item| item.message)
            .unwrap_or_else(|| "İşletme lisansı geçersiz veya cihaz iptal edilmiş.".to_string());
        license::record(&mut conn, None, true, false, Some(&message)).await?;
    } else {
        license::record(&mut conn, None, false, false, Some(OFFLINE)).await?;
    }
    drop(conn);
    current_with_public_key(pool, verification_key).await
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
    link_with_password(&pool, &email, &password).await
}

/// Bulut geri yüklemesi de anahtarı bu yolla alır; şifre yalnız istekte bulunur.
pub(crate) async fn link_with_password(
    pool: &DbPool,
    email: &str,
    password: &str,
) -> Result<LicenseStatus, String> {
    let body = serde_json::json!({ "email": email.trim(), "password": password }).to_string();
    let response = client()?
        .post(format!("{API_URL}/api/desktop/license-key"))
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
    store_and_refresh(pool, &key).await
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
        .get(format!("{API_URL}/api/desktop-link/{code}"))
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

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TenantChoice {
    pub tenant_id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct TenantList {
    tenants: Vec<TenantChoice>,
}

/// Bu kasaya bağlı hesabın sahibi olduğu işletmeler; liste sunucudan gelir, IPC'den gelmez.
pub(crate) async fn account_tenants(pool: &DbPool) -> Result<Vec<TenantChoice>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    drop(conn);
    let key = stored
        .license_key
        .ok_or_else(|| "Kasa henüz hesaba bağlanmadı.".to_string())?;
    let response = client()?
        .get(format!("{API_URL}/api/desktop/tenants"))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|_| OFFLINE.to_string())?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(serde_json::from_str::<Message>(&text)
            .ok()
            .and_then(|m| m.message)
            .unwrap_or_else(|| "İşletmeler alınamadı.".to_string()));
    }
    serde_json::from_str::<TenantList>(&text)
        .map(|list| list.tenants)
        .map_err(|_| "Sunucu yanıtı okunamadı.".to_string())
}

/// Seçilen işletmeye bu cihazı etkinleştirir ve imzalı lisansı alır (cihaz sınırı Labs'te uygulanır).
pub(crate) async fn activate_for_tenant(
    pool: &DbPool,
    tenant_id: &str,
    tenant_name: &str,
) -> Result<(LicenseStatus, String, String), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let stored = license::load(&mut conn).await?;
    drop(conn);
    let key = stored
        .license_key
        .ok_or_else(|| "Kasa henüz hesaba bağlanmadı.".to_string())?;
    let status = refresh_tenant(pool, &stored.device_id, &key, tenant_id, tenant_name).await?;
    Ok((status, key, stored.device_id))
}

async fn store_and_refresh(pool: &DbPool, key: &str) -> Result<LicenseStatus, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    license::load(&mut conn).await?;
    license::save_key(&mut conn, key).await?;
    drop(conn);
    refresh(pool).await
}

#[cfg(test)]
#[path = "license_commands_tests.rs"]
mod tests;
