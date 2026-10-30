//! Geri yükleme: veritabanı açılmadan önce, yeniden başlatmaya dayanıklı uygulanır.
//!
//! Neden yeniden açılışta: çalışan havuzun altındaki dosya değiştirilemez. İşaret
//! dosyası bırakılır; açılışta doğrulanmış kopya hazırlanır, eski dosyalar silinmez,
//! kenara alınır. Her adımda elektrik kesilebilir: işaret silinene kadar iş baştan
//! tekrarlanır ve WAL'ı başka veritabanına ait dosyayla buluşmaz.

use super::{verify_backup, verify_file, BackupError};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
struct Pending {
    backup: String,
    sha256: String,
}

fn sibling(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn io_error(context: &str, error: std::io::Error) -> BackupError {
    BackupError::Io(format!("{context}: {error}"))
}

/// Dosyayı doğrular ve bir sonraki açılış için işaretler.
pub async fn schedule_restore(db_path: &Path, backup: &Path) -> Result<(), BackupError> {
    let sha256 = verify_file(backup).await?;
    let pending = Pending {
        backup: backup.display().to_string(),
        sha256,
    };
    let text = serde_json::to_string(&pending).map_err(|e| BackupError::Io(e.to_string()))?;
    let marker = sibling(db_path, ".restore");
    let partial = sibling(db_path, ".restore.partial");
    fs::write(&partial, text).map_err(|e| io_error("işaret yazılamadı", e))?;
    fs::rename(&partial, &marker).map_err(|e| io_error("işaret yayınlanamadı", e))
}

/// Geri dönen dosyayı bu cihaza hazırlar.
///
/// Küme kayıtları silinir: eski konumdaki üye diğer cihazların ilerlemiş günlüğünü
/// geriye sarabilir. Hesap oturumu kapanır: yedeği yükleyen kişi şifreyle girmelidir.
async fn prepare(path: &Path, source: &str) -> Result<(), BackupError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .journal_mode(SqliteJournalMode::Delete);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| BackupError::Sql(e.to_string()))?;
    let sql_error = |e: sqlx::Error| BackupError::Sql(e.to_string());
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'sync\\_%' ESCAPE '\\' AND name != 'sync_device_key'",
    )
    .fetch_all(&pool)
    .await
    .map_err(sql_error)?;
    for table in tables {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&pool)
            .await
            .map_err(sql_error)?;
    }
    sqlx::raw_sql(include_str!("device_backup.sql"))
        .execute(&pool)
        .await
        .map_err(sql_error)?;
    sqlx::query(
        "INSERT INTO device_backup (slot, last_restored_at, restored_from, restore_audit_pending)
         VALUES (1, datetime('now'), ?1, 1)
         ON CONFLICT(slot) DO UPDATE SET last_restored_at = datetime('now'), restored_from = ?1,
                                         restore_audit_pending = 1",
    )
    .bind(source)
    .execute(&pool)
    .await
    .map_err(sql_error)?;
    let has_session: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'device_session'",
    )
    .fetch_one(&pool)
    .await
    .map_err(sql_error)?;
    if has_session > 0 {
        sqlx::query("UPDATE device_session SET user_id = NULL, tenant_id = NULL")
            .execute(&pool)
            .await
            .map_err(sql_error)?;
    }
    pool.close().await;
    Ok(())
}

/// Bekleyen geri yüklemeyi uygular. Hata çağırana döner; çağıran işareti bırakır ve
/// mevcut veriyle açar: yedek kaybolduysa işletme kilitli kalmamalıdır.
pub async fn apply_pending_restore(db_path: &Path) -> Result<bool, BackupError> {
    let marker = sibling(db_path, ".restore");
    if !marker.exists() {
        return Ok(false);
    }
    let text = fs::read_to_string(&marker).map_err(|e| io_error("işaret okunamadı", e))?;
    let pending: Pending =
        serde_json::from_str(&text).map_err(|e| BackupError::Io(e.to_string()))?;
    let backup = PathBuf::from(&pending.backup);
    verify_backup(&backup, &pending.sha256)?;

    let prepared = sibling(db_path, ".restoring");
    fs::copy(&backup, &prepared).map_err(|e| io_error("yedek kopyalanamadı", e))?;
    prepare(&prepared, &pending.backup).await?;
    fs::OpenOptions::new()
        .write(true)
        .open(&prepared)
        .and_then(|file| file.sync_all())
        .map_err(|e| io_error("kopya diske yazılamadı", e))?;

    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string();
    let aside = sibling(db_path, &format!(".before-restore-{stamp}"));
    fs::create_dir_all(&aside).map_err(|e| io_error("eski veri klasörü açılamadı", e))?;
    // WAL önce taşınır: ana dosyadan sonra kalan WAL yeni dosyaya uygulanabilirdi.
    for suffix in ["-wal", "-shm", ""] {
        let source = sibling(db_path, suffix);
        if source.exists() {
            let name = source
                .file_name()
                .ok_or_else(|| BackupError::Missing(source.display().to_string()))?;
            fs::rename(&source, aside.join(name))
                .map_err(|e| io_error("eski veri taşınamadı", e))?;
        }
    }
    fs::rename(&prepared, db_path).map_err(|e| io_error("yedek yerleştirilemedi", e))?;
    fs::remove_file(&marker).map_err(|e| io_error("işaret silinemedi", e))?;
    Ok(true)
}

/// Uygulanamayan işareti kaldırır; dosya incelenmek üzere kenarda kalır.
pub fn abandon_pending_restore(db_path: &Path) {
    let _ = fs::rename(
        sibling(db_path, ".restore"),
        sibling(db_path, ".restore.failed"),
    );
}
