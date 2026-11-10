//! Masaüstü uygulama güncellemesinin iş kuralları (ağdan ve arayüzden bağımsız kısım).
//!
//! Neden ayrı: kurulum kararı (açık vardiya/sipariş varken kurma yok) ve hata sınıflaması
//! ağ gerektirmeden test edilebilsin. İmza doğrulaması güncelleyici eklentisindedir;
//! bu modül imzayı gevşetmez, yalnız "ne zaman kurulabilir" sorusunu yanıtlar.

use serde::Serialize;
use sqlx::SqlitePool;

/// Arayüze dönen denetim sonucu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpdateStatus {
    /// Güncelleme anahtarı yapılandırılmamış veya platform desteklemiyor; ağa çıkılmadı.
    Unconfigured,
    UpToDate,
    Available,
    /// Sunucuya ulaşılamadı; satışı etkilemez, otomatik denetimde sessiz geçilir.
    Offline,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub status: UpdateStatus,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub message: Option<String>,
}

impl UpdateCheck {
    pub fn new(current_version: &str, status: UpdateStatus) -> Self {
        Self {
            current_version: current_version.to_string(),
            status,
            version: None,
            notes: None,
            message: None,
        }
    }
}

/// Açık pubkey boşsa güncelleme kapalıdır: doğrulanamayan paket asla kurulmaz.
pub fn is_pubkey_configured(pubkey: &str) -> bool {
    let key = pubkey.trim();
    !key.is_empty() && !key.starts_with("YOUR_")
}

/// Ağ kopukluğu ile gerçek hata ayrılır: ilki sessiz geçilir, ikincisi gösterilir.
pub fn classify_error(error: &tauri_plugin_updater::Error) -> UpdateStatus {
    use tauri_plugin_updater::Error;
    match error {
        // Henüz yayın yoksa da `latest.json` bulunamaz; kullanıcıya hata değil "ulaşılamadı" denir.
        Error::Reqwest(_) | Error::ReleaseNotFound | Error::Network(_) => UpdateStatus::Offline,
        _ => UpdateStatus::Error,
    }
}

/// Kurulum yeniden başlatma gerektirir; açık vardiya veya sipariş varken satış kesilmez.
pub fn blocker_message(open_shifts: i64, open_orders: i64) -> Option<String> {
    if open_shifts == 0 && open_orders == 0 {
        return None;
    }
    let mut parts = Vec::new();
    if open_shifts > 0 {
        parts.push("açık vardiya");
    }
    if open_orders > 0 {
        parts.push("açık sipariş");
    }
    Some(format!(
        "UPDATE_BLOCKED: {} varken güncelleme kurulmaz; önce kapatın.",
        parts.join(" ve ")
    ))
}

/// Bu işletmedeki açık vardiya ve sipariş sayısı. Sorgu hatası yukarı taşınır (fail-closed):
/// sayılamayan durum "açık yok" sayılıp kurulum başlatılmaz.
pub async fn count_open_work(pool: &SqlitePool, tenant_id: &str) -> Result<(i64, i64), String> {
    let shifts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM shifts WHERE tenant_id = ? AND status = 'OPEN'")
            .bind(tenant_id)
            .fetch_one(pool)
            .await
            .map_err(|error| error.to_string())?;
    let orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok((shifts, orders))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("bellek içi veritabanı açılmalı");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema uygulanmalı");
        pool
    }

    #[test]
    fn bos_veya_ornek_anahtar_yapilandirilmamis_sayilir() {
        assert!(!is_pubkey_configured(""));
        assert!(!is_pubkey_configured("   "));
        assert!(!is_pubkey_configured("YOUR_UPDATE_PUBLIC_KEY_BASE64"));
        assert!(is_pubkey_configured("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu"));
    }

    #[test]
    fn acik_vardiya_veya_siparis_kurulumu_engeller() {
        assert!(blocker_message(0, 0).is_none());
        assert!(blocker_message(1, 0).is_some_and(|text| text.contains("vardiya")));
        assert!(blocker_message(0, 2).is_some_and(|text| text.contains("sipariş")));
        let both = blocker_message(1, 1).unwrap_or_default();
        assert!(both.starts_with("UPDATE_BLOCKED") && both.contains("vardiya ve açık sipariş"));
    }

    #[test]
    fn ag_hatasi_sessiz_imza_benzeri_hata_acik_siniflanir() {
        use tauri_plugin_updater::Error;
        assert_eq!(
            classify_error(&Error::ReleaseNotFound),
            UpdateStatus::Offline
        );
        assert_eq!(classify_error(&Error::EmptyEndpoints), UpdateStatus::Error);
        assert_eq!(
            classify_error(&Error::SignatureUtf8("x".into())),
            UpdateStatus::Error
        );
    }

    #[tokio::test]
    async fn acik_is_yalniz_kendi_kiracisi_icin_sayilir() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) \
             VALUES ('shf_1', 'tnt_a', 'usr_1', 'OPEN', datetime('now'), 0)",
        )
        .execute(&pool)
        .await
        .expect("vardiya yazılmalı");
        assert_eq!(count_open_work(&pool, "tnt_a").await, Ok((1, 0)));
        assert_eq!(count_open_work(&pool, "tnt_b").await, Ok((0, 0)));
    }
}
