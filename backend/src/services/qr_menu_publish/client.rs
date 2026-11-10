//! QR menü uçlarının HTTP istemcisi (`docs/contracts/qr-menu.md`).
//!
//! Kimlik, bulut eşitlemesiyle aynıdır: lisans anahtarı ve lisans cihaz kimliği. Ağ
//! hatası `ApiError::Transient` olarak döner; çağıran satışı bekletmez, yalnız yayını
//! başarısız sayar.

use crate::services::cloud_sync::api::{encode_query, send, ApiError, Credentials};
use serde_json::Value;
use std::time::Duration;

pub struct QrMenuClient {
    base: String,
    client: reqwest::Client,
}

impl QrMenuClient {
    pub fn new(base: &str) -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "Bağlantı hazırlanamadı.".to_string())?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            client,
        })
    }

    fn url(&self, tenant_id: &str, path: &str) -> String {
        format!(
            "{}/api/desktop/tenants/{}/{path}",
            self.base,
            encode_query(tenant_id)
        )
    }

    fn authorize(
        &self,
        request: reqwest::RequestBuilder,
        credentials: &Credentials,
    ) -> reqwest::RequestBuilder {
        request
            .bearer_auth(&credentials.license_key)
            .header("x-device-id", &credentials.license_device_id)
    }

    pub async fn status(&self, credentials: &Credentials) -> Result<Value, ApiError> {
        let url = self.url(&credentials.tenant_id, "menu/status");
        send(self.authorize(self.client.get(url), credentials)).await
    }

    /// Ham WebP baytlarını yükler; aynı bayt tekrar yüklenirse sunucu idempotent yanıtlar.
    pub async fn upload_image(
        &self,
        credentials: &Credentials,
        bytes: Vec<u8>,
    ) -> Result<Value, ApiError> {
        let url = self.url(&credentials.tenant_id, "menu/images");
        let request = self
            .client
            .put(url)
            .header("content-type", "image/webp")
            .body(bytes);
        send(self.authorize(request, credentials)).await
    }

    pub async fn publish(
        &self,
        credentials: &Credentials,
        body: String,
    ) -> Result<Value, ApiError> {
        let url = self.url(&credentials.tenant_id, "menu");
        let request = self
            .client
            .put(url)
            .header("content-type", "application/json")
            .body(body);
        send(self.authorize(request, credentials)).await
    }
}

/// Sunucu `code` değerine göre kullanıcıya gösterilecek Türkçe ileti. Karar `message`
/// metnine bağlanmaz; bilinmeyen kod sunucu iletisini ya da kodu olduğu gibi gösterir.
pub fn user_message(error: &ApiError) -> String {
    let text = match error.code() {
        "NETWORK" => {
            "İnternet bağlantısı yok. Satış etkilenmedi; bağlantı gelince menüyü yeniden yayınlayın."
        }
        "INVALID_KEY" => "Lisans anahtarı geçersiz. Cihaz bağlantısını Ayarlar'dan kontrol edin.",
        "EMAIL_NOT_VERIFIED" => "Hesabın e-postası doğrulanmamış.",
        "INVALID_DEVICE" | "DEVICE_NOT_LICENSED" => "Bu cihaz bu işletme için lisanslı değil.",
        "DEVICE_REVOKED" => "Bu cihazın lisansı iptal edilmiş.",
        "LICENSE_BLOCKED" => "İşletmenin lisansı engellenmiş.",
        "LICENSE_INACTIVE" => "Lisans etkin değil ya da süresi dolmuş.",
        "FEATURE_NOT_ENTITLED" => "Paketinizde QR menü hakkı yok.",
        "UPSTREAM_UNAVAILABLE" => "Hak doğrulaması şu an yapılamıyor; biraz sonra yeniden deneyin.",
        "INVALID_MENU" => "Menü sunucu kurallarına uymuyor. Ürün adı, fiyat ve açıklamayı kontrol edin.",
        "UNKNOWN_IMAGE" => "Yüklenmemiş bir görsel menüde kullanılıyor; yeniden yayınlayın.",
        "PAYLOAD_TOO_LARGE" => "Gönderilen veri sunucu sınırını aşıyor (görsel en çok 1,5 MB).",
        "UNSUPPORTED_IMAGE" => "Sunucu görseli WebP olarak tanımadı.",
        "INVALID_IMAGE" => "Görsel geçersiz ya da 1600 pikseli aşıyor.",
        "IMAGE_QUOTA" => "İşletme başına görsel sınırına (500) ulaşıldı.",
        "MEDIA_UNAVAILABLE" => "Sunucuda görsel depolaması hazır değil.",
        _ => "",
    };
    if !text.is_empty() {
        return text.to_string();
    }
    match error {
        ApiError::Transient(reason) => reason.clone(),
        ApiError::Rejected { .. } => format!("Sunucu isteği reddetti: {}", error.message()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn credentials() -> Credentials {
        Credentials {
            tenant_id: "tnt_a".into(),
            license_key: "lk_test".into(),
            license_device_id: "lic_dev".into(),
        }
    }

    fn rejected(status: u16, code: &str) -> ApiError {
        ApiError::Rejected {
            status,
            code: code.into(),
            message: "sunucu iletisi".into(),
            detail: json!({}),
        }
    }

    #[test]
    fn uc_adresi_isletme_yoluna_baglanir() -> Result<(), String> {
        let client = QrMenuClient::new("https://api.example.test/")?;
        assert_eq!(
            client.url("tnt_a", "menu/images"),
            "https://api.example.test/api/desktop/tenants/tnt_a/menu/images"
        );
        Ok(())
    }

    #[test]
    fn hata_kodlari_turkce_iletiye_eslenir() {
        let net = ApiError::Transient("Bulut sunucusuna ulaşılamadı.".into());
        assert!(user_message(&net).contains("İnternet bağlantısı yok"));
        assert!(user_message(&rejected(403, "FEATURE_NOT_ENTITLED")).contains("QR menü hakkı"));
        assert!(user_message(&rejected(403, "DEVICE_REVOKED")).contains("iptal"));
        assert!(user_message(&rejected(413, "PAYLOAD_TOO_LARGE")).contains("1,5 MB"));
        assert!(user_message(&rejected(422, "INVALID_MENU")).contains("Menü"));
        assert_eq!(
            user_message(&rejected(418, "BILINMEYEN")),
            "Sunucu isteği reddetti: sunucu iletisi"
        );
    }

    #[tokio::test]
    async fn gorsel_yukleme_kimlik_basliklari_ve_201_yaniti_ile_calisir() -> Result<(), String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut raw = vec![0u8; 4096];
            let read = socket.read(&mut raw).await.map_err(|e| e.to_string())?;
            let body = r#"{"key":"abc","size":4,"width":1,"height":1}"#;
            let reply = format!(
                "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(reply.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            Ok::<String, String>(String::from_utf8_lossy(&raw[..read]).to_lowercase())
        });
        let client = QrMenuClient::new(&format!("http://{addr}"))?;
        let reply = client
            .upload_image(&credentials(), b"RIFFxxxxWEBP".to_vec())
            .await
            .map_err(|e| e.message())?;
        assert_eq!(reply["key"], "abc");
        let request = server.await.map_err(|e| e.to_string())??;
        assert!(request.starts_with("put /api/desktop/tenants/tnt_a/menu/images "));
        assert!(request.contains("authorization: bearer lk_test"));
        assert!(request.contains("x-device-id: lic_dev"));
        assert!(request.contains("content-type: image/webp"));
        Ok(())
    }
}
