//! Bulut uçlarının istemcisi (`docs/cloud-sync.md`).
//!
//! Ağ katmanı bir arayüzün arkasındadır: gönderici, çekici ve geri yükleme aynı kodla
//! hem gerçek sunucuya hem testteki sahte sunucuya konuşur. Karar yalnız `code`
//! değerine göre verilir; `message` kullanıcıya gösterilir, mantığa girmez.

use serde_json::Value;
use std::future::Future;
use std::time::Duration;

/// Bulut isteğinin kimliği: lisans anahtarı ve lisans cihaz kimliği.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credentials {
    pub tenant_id: String,
    pub license_key: String,
    pub license_device_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApiError {
    /// Ağ hatası, zaman aşımı veya 5xx: aynı istek aynen yeniden denenir.
    Transient(String),
    /// Sunucunun açık reddi; `detail` yanıt gövdesinin tamamıdır.
    Rejected {
        status: u16,
        code: String,
        message: String,
        detail: Value,
    },
}

impl ApiError {
    pub fn code(&self) -> &str {
        match self {
            Self::Transient(_) => "NETWORK",
            Self::Rejected { code, .. } => code,
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Transient(reason) => reason.clone(),
            Self::Rejected { message, code, .. } if message.is_empty() => code.clone(),
            Self::Rejected { message, .. } => message.clone(),
        }
    }
}

/// Sözleşmedeki dört uç. Gövdeler hazır JSON metnidir: gönderilen bayt sayısı sınırla
/// karşılaştırılan sayıyla aynı olsun diye çağıran serileştirir.
pub trait CloudApi: Send + Sync {
    fn push(
        &self,
        credentials: &Credentials,
        body: String,
    ) -> impl Future<Output = Result<Value, ApiError>> + Send;

    fn pull(
        &self,
        credentials: &Credentials,
        after: i64,
        limit: i64,
    ) -> impl Future<Output = Result<Value, ApiError>> + Send;

    fn snapshot(
        &self,
        credentials: &Credentials,
        as_of: Option<i64>,
        cursor: Option<String>,
        limit: i64,
    ) -> impl Future<Output = Result<Value, ApiError>> + Send;

    fn release(
        &self,
        credentials: &Credentials,
        body: String,
    ) -> impl Future<Output = Result<Value, ApiError>> + Send;
}

/// Opak imleç adrese girerken kaçışlanır; ayrılmış karakter sorguyu bölmesin.
pub fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Gerçek sunucu. Adres sabittir (`SITE_URL`); IPC'den adres gelmez.
pub struct HttpApi {
    base: String,
    client: reqwest::Client,
}

impl HttpApi {
    pub fn new(base: &str) -> Result<Self, String> {
        // Sağlayıcı açılışta kurulur; başka girişten çağrılırsa burada da kurulur.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "Bağlantı hazırlanamadı.".to_string())?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            client,
        })
    }

    fn url(&self, tenant_id: &str, path: &str) -> String {
        format!(
            "{}/api/desktop/sync/tenants/{}/{path}",
            self.base,
            encode_query(tenant_id)
        )
    }

    fn get(&self, credentials: &Credentials, path: &str) -> reqwest::RequestBuilder {
        self.client
            .get(self.url(&credentials.tenant_id, path))
            .bearer_auth(&credentials.license_key)
            .header("x-device-id", &credentials.license_device_id)
    }

    fn post(&self, credentials: &Credentials, path: &str, body: String) -> reqwest::RequestBuilder {
        self.client
            .post(self.url(&credentials.tenant_id, path))
            .bearer_auth(&credentials.license_key)
            .header("x-device-id", &credentials.license_device_id)
            .header("content-type", "application/json")
            .body(body)
    }
}

async fn send(request: reqwest::RequestBuilder) -> Result<Value, ApiError> {
    let response = request
        .send()
        .await
        .map_err(|_| ApiError::Transient("Bulut sunucusuna ulaşılamadı.".to_string()))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|_| ApiError::Transient("Bulut yanıtı yarıda kesildi.".to_string()))?;
    if status >= 500 || status == 408 || status == 429 {
        return Err(ApiError::Transient(format!(
            "Bulut sunucusu hata verdi ({status})."
        )));
    }
    let parsed: Option<Value> = serde_json::from_str(&text).ok();
    if status == 200 {
        // Başarı yanıtı okunamazsa işlem bulutta olabilir; aynı gönderim aynen yinelenir.
        return parsed.ok_or_else(|| ApiError::Transient("Bulut yanıtı okunamadı.".to_string()));
    }
    let detail = parsed.unwrap_or(Value::Null);
    let field = |name: &str| detail.get(name).and_then(Value::as_str).map(str::to_string);
    Err(ApiError::Rejected {
        status,
        code: field("code").unwrap_or_else(|| format!("HTTP_{status}")),
        message: field("message").unwrap_or_default(),
        detail,
    })
}

impl CloudApi for HttpApi {
    async fn push(&self, credentials: &Credentials, body: String) -> Result<Value, ApiError> {
        send(self.post(credentials, "push", body)).await
    }

    async fn pull(
        &self,
        credentials: &Credentials,
        after: i64,
        limit: i64,
    ) -> Result<Value, ApiError> {
        let path = format!("pull?after={after}&limit={limit}");
        send(self.get(credentials, &path)).await
    }

    async fn snapshot(
        &self,
        credentials: &Credentials,
        as_of: Option<i64>,
        cursor: Option<String>,
        limit: i64,
    ) -> Result<Value, ApiError> {
        let mut path = format!("snapshot?limit={limit}");
        if let Some(as_of) = as_of {
            path.push_str(&format!("&asOf={as_of}"));
        }
        if let Some(cursor) = cursor {
            path.push_str(&format!("&cursor={}", encode_query(&cursor)));
        }
        send(self.get(credentials, &path)).await
    }

    async fn release(&self, credentials: &Credentials, body: String) -> Result<Value, ApiError> {
        send(self.post(credentials, "release", body)).await
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_query, HttpApi};

    #[test]
    fn imlec_ayrilmis_karakterleri_kacislar() {
        assert_eq!(encode_query("ab-_.~9"), "ab-_.~9");
        assert_eq!(encode_query("a&b=c d"), "a%26b%3Dc%20d");
        assert_eq!(encode_query("ş"), "%C5%9F");
    }

    #[test]
    fn bulut_adresi_kimlik_baglamini_tenant_yoluna_baglar() -> Result<(), String> {
        let api = HttpApi::new("https://api.example.test")?;
        assert_eq!(
            api.url("tnt_01arz3ndektsv4rrffq69g5fav", "push"),
            "https://api.example.test/api/desktop/sync/tenants/tnt_01arz3ndektsv4rrffq69g5fav/push"
        );
        Ok(())
    }
}
