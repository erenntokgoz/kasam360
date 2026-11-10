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

/// Güncelleme öncesi yedeklerinin etiket öneki; sürüm etikete eklenir.
const PRE_UPDATE_TAG: &str = "guncelleme_oncesi";
/// Saklanan güncelleme öncesi yedek sayısı (sürümden bağımsız, en yeniler).
const KEEP_PRE_UPDATE: usize = 3;

/// Sürümü dosya adına güvenli hale getirir; `_` ayraç olduğundan etikette kullanılmaz.
fn version_tag_part(version: &str) -> String {
    version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// En yeni `keep` güncelleme öncesi yedek kalır, eskileri silinir.
/// Neden sürümden bağımsız: her sürümün etiketi farklı olduğundan genel temizlik bunları saymaz.
pub fn prune_pre_update_backups(dir: &std::path::Path, keep: usize) {
    let prefix = format!("{PRE_UPDATE_TAG}_");
    let files = crate::services::backup::list_backups(&[dir.to_path_buf()]);
    for file in files
        .into_iter()
        .filter(|file| file.tag.starts_with(&prefix))
        .skip(keep)
    {
        let path = std::path::PathBuf::from(&file.path);
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(".sha256");
        let _ = std::fs::remove_file(sidecar);
        let _ = std::fs::remove_file(path);
    }
}

/// Kurulumdan hemen önce geçerli ve doğrulanmış yerel yedek alır. Fail-closed: yedek
/// alınamazsa veya doğrulanamazsa hata döner ve çağıran kurulumu başlatmaz; kurulum
/// sonrası veri sorunu çıkarsa dönülecek bir kopya olmadan güncelleme yapılmaz.
pub async fn ensure_pre_update_backup(
    pool: &SqlitePool,
    db_path: Option<&std::path::Path>,
    version: &str,
) -> Result<(), String> {
    use crate::services::backup::{backup_dir_for, schedule, verify_file};
    let db_path = db_path.ok_or_else(|| {
        "UPDATE_BACKUP_FAILED: veritabanı dosya üzerinde değil, yedek alınamadı.".to_string()
    })?;
    let tag = format!("{PRE_UPDATE_TAG}_{}", version_tag_part(version));
    let file = schedule::run_backup(pool, db_path, &tag)
        .await
        .map_err(|error| {
            format!("UPDATE_BACKUP_FAILED: kurulum yapılmadı, yedek alınamadı: {error}")
        })?;
    verify_file(std::path::Path::new(&file.path))
        .await
        .map_err(|error| format!("UPDATE_BACKUP_FAILED: yedek doğrulanamadı: {error}"))?;
    prune_pre_update_backups(&backup_dir_for(db_path), KEEP_PRE_UPDATE);
    Ok(())
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

    async fn file_pool() -> (SqlitePool, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kasam360_upd_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("klasör açılmalı");
        let db_path = dir.join("test.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("dosya veritabanı açılmalı");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema uygulanmalı");
        (pool, db_path)
    }

    #[tokio::test]
    async fn yedek_basarisizsa_kurulum_reddedilir() {
        let (pool, db_path) = file_pool().await;
        pool.close().await;
        let result = ensure_pre_update_backup(&pool, Some(&db_path), "9.9.9").await;
        assert!(result.is_err_and(|e| e.starts_with("UPDATE_BACKUP_FAILED")));
        let no_file = ensure_pre_update_backup(&pool, None, "9.9.9").await;
        assert!(no_file.is_err_and(|e| e.starts_with("UPDATE_BACKUP_FAILED")));
    }

    #[tokio::test]
    async fn yedek_alinir_ve_en_yeni_uc_kalir() {
        let (pool, db_path) = file_pool().await;
        for version in ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"] {
            ensure_pre_update_backup(&pool, Some(&db_path), version)
                .await
                .expect("yedek alınmalı");
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        let dir = crate::services::backup::backup_dir_for(&db_path);
        let kept: Vec<_> = crate::services::backup::list_backups(&[dir])
            .into_iter()
            .filter(|file| file.tag.starts_with("guncelleme_oncesi_"))
            .collect();
        assert_eq!(kept.len(), 3);
        assert!(kept.iter().any(|file| file.tag.ends_with("1.0.4")));
        assert!(!kept.iter().any(|file| file.tag.ends_with("1.0.0")));
    }
}
