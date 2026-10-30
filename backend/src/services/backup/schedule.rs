//! Otomatik yedek, ikinci kopya ve durum kaydı.
//!
//! Yedek hatası satışı durdurmaz ama sessiz de kalmaz: son hata satırda tutulur ve
//! Ayarlar ekranında görünür. Aynı diskteki yedek disk arızasına karşı korumaz; bu
//! yüzden ikinci klasör (harici disk, ağ paylaşımı) ayrı tanımlanır.

use super::{backup_dir_for, create_backup, list_backups, prune, BackupFile};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const PERIOD: Duration = Duration::from_secs(60 * 60);
const FIRST_RUN_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub directory: String,
    pub mirror_dir: Option<String>,
    pub last_backup_at: Option<String>,
    pub last_error: Option<String>,
    pub last_restored_at: Option<String>,
    pub restored_from: Option<String>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

pub async fn load_status(pool: &SqlitePool, db_path: &Path) -> Result<BackupStatus, String> {
    let row = sqlx::query(
        "SELECT mirror_dir, last_backup_at, last_error, last_restored_at, restored_from
         FROM device_backup WHERE slot = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(text_error)?;
    let field = |name: &str| -> Result<Option<String>, String> {
        match &row {
            Some(row) => row.try_get(name).map_err(text_error),
            None => Ok(None),
        }
    };
    Ok(BackupStatus {
        directory: backup_dir_for(db_path).display().to_string(),
        mirror_dir: field("mirror_dir")?,
        last_backup_at: field("last_backup_at")?,
        last_error: field("last_error")?,
        last_restored_at: field("last_restored_at")?,
        restored_from: field("restored_from")?,
    })
}

pub(crate) async fn write_result(
    pool: &SqlitePool,
    error: Option<&str>,
    sequence: Option<i64>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO device_backup (slot, last_backup_at, last_error, last_sequence)
         VALUES (1, CASE WHEN ?1 IS NULL THEN datetime('now') END, ?1, ?2)
         ON CONFLICT(slot) DO UPDATE SET
            last_backup_at = CASE WHEN ?1 IS NULL THEN datetime('now') ELSE last_backup_at END,
            last_error = ?1,
            last_sequence = COALESCE(?2, last_sequence)",
    )
    .bind(error)
    .bind(sequence)
    .execute(pool)
    .await
    .map_err(text_error)?;
    Ok(())
}

pub async fn set_mirror(pool: &SqlitePool, mirror_dir: Option<&str>) -> Result<(), String> {
    if let Some(dir) = mirror_dir {
        fs::create_dir_all(dir).map_err(|e| format!("VALIDATION: klasör açılamadı: {e}"))?;
    }
    sqlx::query(
        "INSERT INTO device_backup (slot, mirror_dir) VALUES (1, ?1)
         ON CONFLICT(slot) DO UPDATE SET mirror_dir = ?1",
    )
    .bind(mirror_dir)
    .execute(pool)
    .await
    .map_err(text_error)?;
    Ok(())
}

async fn current_sequence(pool: &SqlitePool) -> Result<i64, String> {
    sqlx::query_scalar("SELECT COALESCE(MAX(sequence), 0) FROM audit_ledger")
        .fetch_one(pool)
        .await
        .map_err(text_error)
}

/// İkinci klasöre kopyalar. Özet dosyası önce gider: listeleme onu arar.
fn mirror_copy(file: &Path, sha256: &str, mirror: &Path) -> Result<(), String> {
    fs::create_dir_all(mirror).map_err(|e| e.to_string())?;
    let name = file.file_name().ok_or("dosya adı yok")?;
    let target = mirror.join(name);
    let partial = target.with_extension("partial");
    fs::copy(file, &partial).map_err(|e| e.to_string())?;
    let copied = fs::OpenOptions::new()
        .write(true)
        .open(&partial)
        .map_err(|e| e.to_string())?;
    copied.sync_all().map_err(|e| e.to_string())?;
    drop(copied);
    fs::write(super::checksum_path(&target), sha256).map_err(|e| e.to_string())?;
    fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    prune(mirror);
    Ok(())
}

/// Yedek alır, ikinci klasöre kopyalar ve sonucu kaydeder.
pub async fn run_backup(
    pool: &SqlitePool,
    db_path: &Path,
    tag: &str,
) -> Result<BackupFile, String> {
    let dir = backup_dir_for(db_path);
    let sequence = current_sequence(pool).await?;
    let outcome = create_backup(pool, &dir.display().to_string(), tag)
        .await
        .map_err(|e| e.to_string());
    let result = match outcome {
        Ok(result) => result,
        Err(error) => {
            write_result(pool, Some(&error), None).await?;
            return Err(error);
        }
    };
    prune(&dir);

    let mirror = load_status(pool, db_path).await?.mirror_dir;
    if let Some(mirror) = mirror {
        if let Err(error) = mirror_copy(&result.path, &result.sha256, Path::new(&mirror)) {
            // Yerel yedek durur; yine de hata görünür kalır: harici kopya yok demektir.
            let text = format!("İkinci klasöre kopyalanamadı: {error}");
            write_result(pool, Some(&text), Some(sequence)).await?;
            return Err(text);
        }
    }
    write_result(pool, None, Some(sequence)).await?;
    list_backups(&[dir])
        .into_iter()
        .find(|file| file.path == result.path.display().to_string())
        .ok_or_else(|| "yedek listede bulunamadı".to_string())
}

/// Kayıtlı değişiklik varsa saatlik yedek alır.
pub fn spawn_periodic(pool: SqlitePool, db_path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_RUN_DELAY).await;
        loop {
            if let Err(error) = periodic_tick(&pool, &db_path).await {
                tracing::warn!("otomatik yedek alınamadı: {error}");
            }
            tokio::time::sleep(PERIOD).await;
        }
    });
}

async fn periodic_tick(pool: &SqlitePool, db_path: &Path) -> Result<(), String> {
    let last: Option<i64> =
        sqlx::query_scalar("SELECT last_sequence FROM device_backup WHERE slot = 1")
            .fetch_optional(pool)
            .await
            .map_err(text_error)?
            .flatten();
    if last == Some(current_sequence(pool).await?) {
        return Ok(());
    }
    run_backup(pool, db_path, "otomatik").await.map(|_| ())
}

/// Geri yükleme sonrası ilk açılışta kritik işlem kaydını yazar.
///
/// Eski dosya defteri zaten yedekteki halindedir; kaydın geri dönmüş veritabanına
/// yazılması gerekir, bu yüzden açılışa bırakılır.
pub async fn record_restore_audit(pool: &SqlitePool) -> Result<(), String> {
    let pending: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT restore_audit_pending, restored_from FROM device_backup WHERE slot = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(text_error)?;
    let Some((1, restored_from)) = pending else {
        return Ok(());
    };
    let tenant: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM app_setup WHERE slot = 1")
            .fetch_optional(pool)
            .await
            .map_err(text_error)?
            .flatten();
    if let Some(tenant) = tenant {
        let mutex = tokio::sync::Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let ctx = AuditContext::new(
            tenant.clone(),
            "system".to_string(),
            "OWNER".to_string(),
            category::GUVENLIK,
            "backup:restored",
            tenant,
            serde_json::json!({ "note": restored_from }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        AuditService::append(&mut conn, &lock, &ctx).await?;
    }
    sqlx::query("UPDATE device_backup SET restore_audit_pending = 0 WHERE slot = 1")
        .execute(pool)
        .await
        .map_err(text_error)?;
    Ok(())
}
