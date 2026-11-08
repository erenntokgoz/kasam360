//! Yedekleme servisi testleri.
//!
//! Kapsam: backup + restore, checksum doğrulama, zincir doğrulaması,
//! sessiz sıfır dönüş yok (AGENTS.md §3.4).

use crate::services::backup::{
    backup_dir_for, check_integrity, create_backup, db_path_from_url, delete_listed, list_backups,
    prune,
    restore::{apply_pending_restore, schedule_restore},
    verify_backup, verify_file,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

async fn pool() -> sqlx::SqlitePool {
    // VACUUM INTO bir dosyaya yazabilmek için dosya tabanlı havuz gerekir;
    // bellek içi havuz `VACUUM INTO 'file:...'` ile dosya oluşturamaz.
    let dir = std::env::temp_dir().join(format!(
        "kasam360_backup_pool_{}_{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
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

/// Gerçek veritabanı dosyası: geri yükleme testi çalışan havuz gibi WAL kullanır.
async fn live_db() -> (PathBuf, sqlx::SqlitePool) {
    let dir = std::env::temp_dir().join(format!("kasam360_restore_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("klasör");
    let db = dir.join("app.db");
    let options = SqliteConnectOptions::new()
        .filename(&db)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("havuz");
    sqlx::raw_sql(
        "CREATE TABLE notes (v TEXT); INSERT INTO notes VALUES ('yedekte');
         CREATE TABLE sync_cluster (slot INTEGER); INSERT INTO sync_cluster VALUES (1);
         CREATE TABLE sync_device_key (slot INTEGER); INSERT INTO sync_device_key VALUES (1);",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    (db, pool)
}

async fn reopen(db: &Path) -> sqlx::SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(db))
        .await
        .expect("yeniden açılış")
}

#[tokio::test]
async fn geri_yukleme_veriyi_doner_kumeyi_siler_eski_veriyi_saklar() {
    let (db, pool) = live_db().await;
    let dir = backup_dir_for(&db).display().to_string();
    let backup = create_backup(&pool, &dir, "elle").await.expect("yedek");
    sqlx::query("INSERT INTO notes VALUES ('sonradan')")
        .execute(&pool)
        .await
        .expect("ek kayıt");
    pool.close().await;

    schedule_restore(&db, &backup.path).await.expect("işaret");
    assert!(apply_pending_restore(&db).await.expect("uygula"));
    assert!(!apply_pending_restore(&db).await.expect("ikinci açılış"));

    let pool = reopen(&db).await;
    let notes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(&pool)
        .await
        .expect("sayı");
    assert_eq!(notes, 1);
    let cluster: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_cluster")
        .fetch_one(&pool)
        .await
        .expect("küme");
    assert_eq!(cluster, 0);
    let key: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_device_key")
        .fetch_one(&pool)
        .await
        .expect("anahtar");
    assert_eq!(key, 1);
    let pending: i64 = sqlx::query_scalar("SELECT restore_audit_pending FROM device_backup")
        .fetch_one(&pool)
        .await
        .expect("durum");
    assert_eq!(pending, 1);
    pool.close().await;

    let parent = db.parent().expect("klasör");
    let aside = fs::read_dir(parent)
        .expect("liste")
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .contains("before-restore")
        })
        .expect("eski veri klasörü");
    let kept = reopen(&aside.path().join("app.db")).await;
    let old: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(&kept)
        .await
        .expect("eski");
    assert_eq!(old, 2, "eski veri WAL'ıyla birlikte saklanır");
}

#[tokio::test]
async fn bozuk_yedek_isaretlenmez_uygulama_veriye_dokunmaz() {
    let (db, pool) = live_db().await;
    let dir = backup_dir_for(&db).display().to_string();
    let backup = create_backup(&pool, &dir, "elle").await.expect("yedek");
    fs::write(&backup.path, b"bozuk").expect("boz");
    assert!(verify_file(&backup.path).await.is_err());
    assert!(schedule_restore(&db, &backup.path).await.is_err());
    assert!(!apply_pending_restore(&db).await.expect("işaret yok"));
}

#[tokio::test]
async fn ozeti_olmayan_yedek_listelenmez_ve_reddedilir() {
    let (db, pool) = live_db().await;
    let dir = backup_dir_for(&db).display().to_string();
    let backup = create_backup(&pool, &dir, "elle").await.expect("yedek");
    check_integrity(&backup.path).await.expect("bütünlük");
    let dirs = [PathBuf::from(&dir)];
    assert_eq!(list_backups(&dirs).len(), 1);
    let mut sidecar = backup.path.as_os_str().to_os_string();
    sidecar.push(".sha256");
    fs::remove_file(sidecar).expect("sil");
    assert!(list_backups(&dirs).is_empty());
    assert!(verify_file(&backup.path).await.is_err());
}

#[tokio::test]
async fn eski_yedekler_tur_basina_temizlenir() {
    let (db, pool) = live_db().await;
    let dir = backup_dir_for(&db);
    let text = dir.display().to_string();
    for _ in 0..32 {
        create_backup(&pool, &text, "otomatik")
            .await
            .expect("yedek");
    }
    create_backup(&pool, &text, "gunsonu")
        .await
        .expect("gün sonu");
    prune(&dir);
    let files = list_backups(&[dir]);
    assert_eq!(
        files.iter().filter(|file| file.tag == "otomatik").count(),
        30
    );
    assert_eq!(files.iter().filter(|file| file.tag == "gunsonu").count(), 1);
}

#[test]
fn adresten_dosya_yolu_cikar() {
    assert_eq!(
        db_path_from_url("sqlite:///C:/x/a.db"),
        Some(PathBuf::from("C:/x/a.db"))
    );
    assert_eq!(
        db_path_from_url("sqlite://kasam360.db"),
        Some(PathBuf::from("kasam360.db"))
    );
    assert_eq!(
        db_path_from_url("sqlite:///tmp/a.db?mode=rwc"),
        Some(PathBuf::from("/tmp/a.db"))
    );
    assert_eq!(db_path_from_url("sqlite::memory:"), None);
    assert_eq!(
        backup_dir_for(Path::new("kasam360.db")),
        PathBuf::from("./backups")
    );
}

#[tokio::test]
async fn silme_yalniz_listedeki_yedege_ulasir() {
    let (db, pool) = live_db().await;
    let dir = backup_dir_for(&db);
    let backup = create_backup(&pool, &dir.display().to_string(), "elle")
        .await
        .expect("yedek");
    let outsider = dir.join("disarida.db");
    fs::write(&outsider, b"x").expect("dosya");
    let dirs = [dir];

    assert!(delete_listed(&dirs, &outsider).is_err());
    assert!(outsider.exists());

    delete_listed(&dirs, &backup.path).expect("silinir");
    assert!(list_backups(&dirs).is_empty());
}

/// Gerçek kasa şemasıyla: başka bir SQLite dosyası ve sahipsiz/kopuk zincirli kasa reddedilir.
#[tokio::test]
async fn kasa_olmayan_veya_kopuk_zincirli_yedek_kurulmaz() {
    let dir = std::env::temp_dir().join(format!("kasam360_shape_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("klasör");
    let open = |name: &str| {
        let path = dir.join(name);
        async move {
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("havuz")
        }
    };
    let foreign = open("yabanci.db").await;
    sqlx::raw_sql("CREATE TABLE x (a)")
        .execute(&foreign)
        .await
        .expect("tablo");
    foreign.close().await;
    assert!(super::check_till_backup(&dir.join("yabanci.db"))
        .await
        .is_err());

    let till = open("kasa.db").await;
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&till)
        .await
        .expect("şema");
    till.close().await;
    assert!(
        super::check_till_backup(&dir.join("kasa.db"))
            .await
            .is_err(),
        "sahipsiz kasa"
    );

    let till = open("kasa.db").await;
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO users (id, tenant_id, role, name) VALUES ('usr_1', 'tnt_a', 'OWNER', 'Sahip');",
    )
    .execute(&till)
    .await
    .expect("sahip");
    till.close().await;
    super::check_till_backup(&dir.join("kasa.db"))
        .await
        .expect("geçerli kasa");
}
