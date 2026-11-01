//! Yedekleme servisi: tutarlı kopya, bütünlük denetimi, listeleme ve temizlik.
//!
//! Neden geçici dosya ve sonradan yeniden adlandırma: yedek sırasında elektrik
//! kesilirse yarım dosya listede görünmemelidir. Dosya ancak bütünlüğü doğrulanıp
//! diske indirildikten sonra son adını alır; özet dosyası ondan önce yazılır.

pub mod restore;
pub mod schedule;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::fs;
use std::path::{Path, PathBuf};

/// Yedek türü başına saklanan dosya sayısı.
const KEEP_PER_TAG: usize = 30;

#[derive(Debug, Clone)]
pub struct BackupResult {
    pub path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub tag: String,
    pub bytes: u64,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("IO hatası: {0}")]
    Io(String),
    #[error("SQL hatası: {0}")]
    Sql(String),
    #[error("checksum uyuşmazlığı: beklenen {expected}, bulunan {found}")]
    ChecksumMismatch { expected: String, found: String },
    #[error("yedek dosyası yok: {0}")]
    Missing(String),
    #[error("yedek bozuk: {0}")]
    Corrupt(String),
}

fn io_error(context: &str, error: std::io::Error) -> BackupError {
    BackupError::Io(format!("{context}: {error}"))
}

fn checksum_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".sha256");
    PathBuf::from(name)
}

fn file_sha256(path: &Path) -> Result<String, BackupError> {
    let data = fs::read(path).map_err(|e| io_error("yedek dosyası okunamadı", e))?;
    Ok(hex::encode(Sha256::digest(&data)))
}

/// Dosyayı salt okunur açıp SQLite'ın kendi bütünlük denetimini çalıştırır.
pub async fn check_integrity(path: &Path) -> Result<(), BackupError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .immutable(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| BackupError::Corrupt(e.to_string()))?;
    let result: Result<String, sqlx::Error> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await;
    pool.close().await;
    match result {
        Ok(text) if text == "ok" => Ok(()),
        Ok(text) => Err(BackupError::Corrupt(text)),
        Err(error) => Err(BackupError::Corrupt(error.to_string())),
    }
}

/// Veritabanının tutarlı kopyasını alır ve doğrulanmış olarak yayınlar.
pub async fn create_backup(
    pool: &SqlitePool,
    backup_dir: &str,
    tag: &str,
) -> Result<BackupResult, BackupError> {
    fs::create_dir_all(backup_dir).map_err(|e| io_error("yedek klasörü oluşturulamadı", e))?;

    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let path = PathBuf::from(backup_dir).join(format!("kasam360_{tag}_{ts}.db"));
    let partial = path.with_extension("partial");

    // Yol parametre olarak gider: klasör adındaki tırnak SQL'i bozamaz.
    sqlx::query("VACUUM INTO ?")
        .bind(partial.display().to_string())
        .execute(pool)
        .await
        .map_err(|e| BackupError::Sql(format!("VACUUM INTO hatası: {e}")))?;

    let published = async {
        check_integrity(&partial).await?;
        let file = fs::OpenOptions::new()
            .write(true)
            .open(&partial)
            .map_err(|e| io_error("yedek açılamadı", e))?;
        file.sync_all()
            .map_err(|e| io_error("yedek diske yazılamadı", e))?;
        let bytes = file
            .metadata()
            .map_err(|e| io_error("yedek okunamadı", e))?
            .len();
        let sha256 = file_sha256(&partial)?;
        fs::write(checksum_path(&path), &sha256).map_err(|e| io_error("özet yazılamadı", e))?;
        fs::rename(&partial, &path).map_err(|e| io_error("yedek yayınlanamadı", e))?;
        Ok::<_, BackupError>((bytes, sha256))
    }
    .await;

    match published {
        Ok((bytes, sha256)) => Ok(BackupResult {
            path,
            bytes,
            sha256,
            timestamp: ts,
        }),
        Err(error) => {
            let _ = fs::remove_file(&partial);
            let _ = fs::remove_file(checksum_path(&path));
            Err(error)
        }
    }
}

pub fn verify_backup(path: &Path, expected_sha256: &str) -> Result<(), BackupError> {
    if !path.exists() {
        return Err(BackupError::Missing(path.display().to_string()));
    }
    let found = file_sha256(path)?;
    if found != expected_sha256 {
        return Err(BackupError::ChecksumMismatch {
            expected: expected_sha256.to_string(),
            found,
        });
    }
    Ok(())
}

/// Dosyayı yanındaki özet ve SQLite denetimiyle doğrular. Özeti olmayan dosya
/// geri yüklenmez: yarım veya elle değiştirilmiş kopya ayırt edilemez.
pub async fn verify_file(path: &Path) -> Result<String, BackupError> {
    let sidecar = checksum_path(path);
    let expected = fs::read_to_string(&sidecar)
        .map_err(|_| BackupError::Missing(sidecar.display().to_string()))?;
    let expected = expected.trim().to_string();
    verify_backup(path, &expected)?;
    check_integrity(path).await?;
    Ok(expected)
}

fn parse_name(name: &str) -> Option<(String, String)> {
    let stem = name.strip_prefix("kasam360_")?.strip_suffix(".db")?;
    let (tag, stamp) = stem.rsplit_once('_')?;
    Some((tag.to_string(), stamp.to_string()))
}

fn read_dir_backups(dir: &Path) -> Vec<BackupFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            let (tag, created_at) = parse_name(&name)?;
            if !checksum_path(&path).exists() {
                return None;
            }
            Some(BackupFile {
                bytes: entry.metadata().ok()?.len(),
                path: path.display().to_string(),
                name,
                tag,
                created_at,
            })
        })
        .collect()
}

/// Klasörlerdeki yayınlanmış yedekler, en yeni başta.
pub fn list_backups(dirs: &[PathBuf]) -> Vec<BackupFile> {
    let mut files: Vec<BackupFile> = dirs.iter().flat_map(|dir| read_dir_backups(dir)).collect();
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    files
}

/// Yalnız listede görünen yedek silinir: dışarıdan gelen yol başka dosyaya ulaşamaz.
pub fn delete_listed(dirs: &[PathBuf], file_path: &Path) -> Result<(), BackupError> {
    let path = list_backups(dirs)
        .into_iter()
        .map(|file| PathBuf::from(file.path))
        .find(|path| path == file_path)
        .ok_or_else(|| BackupError::Missing(file_path.display().to_string()))?;
    fs::remove_file(&path).map_err(|e| io_error("yedek silinemedi", e))?;
    fs::remove_file(checksum_path(&path)).map_err(|e| io_error("özet silinemedi", e))
}

/// Her türün son kopyaları kalır; disk yedekle dolup satışı durdurmamalıdır.
pub fn prune(dir: &Path) {
    let files = list_backups(&[dir.to_path_buf()]);
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for file in files {
        let count = seen.entry(file.tag.clone()).or_insert(0);
        *count += 1;
        if *count > KEEP_PER_TAG {
            let path = PathBuf::from(&file.path);
            let _ = fs::remove_file(checksum_path(&path));
            let _ = fs::remove_file(path);
        }
    }
}

/// `sqlite:` adresinden dosya yolunu çıkarır. Bellek içi veritabanında yol yoktur.
pub fn db_path_from_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("sqlite:")?;
    let rest = rest.split('?').next()?;
    let rest = rest.strip_prefix("//").unwrap_or(rest);
    if rest.is_empty() || rest.contains(":memory:") {
        return None;
    }
    let bytes = rest.as_bytes();
    let windows_drive = bytes.len() > 2 && bytes[0] == b'/' && bytes[2] == b':';
    Some(PathBuf::from(if windows_drive { &rest[1..] } else { rest }))
}

pub fn backup_dir_for(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
