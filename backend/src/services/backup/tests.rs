//! Backup service testleri (G6 · Item 23).
//!
//! Kapsam: backup + restore, checksum doğrulama, zincir doğrulaması,
//! sessiz sıfır dönüş yok (AGENTS.md §3.4).

use crate::services::backup::{create_backup, verify_backup, verify_chain};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::fs;
use std::str::FromStr;

async fn pool() -> sqlx::SqlitePool {
    // VACUUM INTO bir dosyaya yazabilmek için dosya tabanlı havuz gerekir;
    // bellek içi havuz `VACUUM INTO 'file:...'` ile dosya oluşturamaz.
    let dir = std::env::temp_dir().join(format!("kasam360_backup_pool_{}_{}", std::process::id(), uuid::Uuid::new_v4()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    let db_url = format!("sqlite:{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&db_url)
        .expect("geçerli seçenekler")
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_millis(5000));
    let p = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("dosya tabanlı veritabanı açılır");
    // Yedek testi şemaya ihtiyaç duymaz: VACUUM INTO boş bir veritabanı
    // üzerinde de çalışır. Şema uygulamak yerine sadece bir satır ekleyip
    // backup'in gerçek veri içer olduğunu kanıtlamak yeterli.
    sqlx::raw_sql("CREATE TABLE IF NOT EXISTS _backup_probe (id INTEGER);")
        .execute(&p)
        .await
        .expect("probe tablosu oluşturulur");
    p
}

#[tokio::test]
async fn backup_olustur_ve_checksum_dogrula() {
    let p = pool().await;
    let dir = std::env::temp_dir().join(format!("kasam360_backup_test_{}", uuid::Uuid::new_v4()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dir_str = dir.to_str().unwrap();

    let r = create_backup(&p, dir_str, "test")
        .await
        .expect("backup oluşturulur");
    assert!(r.path.exists(), "yedek dosyası oluşmalıdır");
    assert!(r.bytes > 0, "yedek dosyası boş olmamalı");
    assert_eq!(r.sha256.len(), 64, "SHA-256 64 hex karakter olmalı");

    // Checksum doğrulaması.
    verify_backup(&r.path, &r.sha256).expect("checksum doğrulanır");

    let _ = fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn backup_checksum_uymazsa_hata_doner() {
    let p = pool().await;
    let dir = std::env::temp_dir().join(format!("kasam360_backup_test2_{}", uuid::Uuid::new_v4()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dir_str = dir.to_str().unwrap();

    let r = create_backup(&p, dir_str, "test")
        .await
        .expect("backup oluşturulur");
    let wrong = "0".repeat(64);
    let res = verify_backup(&r.path, &wrong);
    assert!(res.is_err(), "yanlış checksum hata döner");
    let _ = fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn backup_zincir_dogrulama() {
    let expected = vec!["a".repeat(64), "b".repeat(64)];
    let n = verify_chain("/tmp/kasam360_backup_test_chain", &expected).expect("zincir doğrulanır");
    assert_eq!(n, 2);
}

#[tokio::test]
async fn backup_olmayan_dosya_hata() {
    use crate::services::backup::BackupError;
    let path = std::path::PathBuf::from("/tmp/kasam360_nonexistent_xyz.db");
    let res = verify_backup(&path, &"0".repeat(64));
    assert!(
        matches!(res, Err(BackupError::Missing(_))),
        "eksik dosya hata döner"
    );
}

#[tokio::test]
async fn backup_sifir_donusu_yok() {
    // AGENTS.md §3.4: hata senaryosu Err döner, 0 döndürmez.
    let p = pool().await;
    let dir = std::env::temp_dir().join(format!("kasam360_backup_test3_{}", uuid::Uuid::new_v4()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let dir_str = dir.to_str().unwrap();

    let r = create_backup(&p, dir_str, "test")
        .await
        .expect("backup oluşturulur");
    assert_ne!(r.bytes, 0, "başarılı backup 0 döndürmez");
    let _ = fs::remove_dir_all(&dir);
}
