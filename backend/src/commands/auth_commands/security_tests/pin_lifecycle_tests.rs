//! Fabrika öntanımlı PIN zorunlu değişimi ve PIN yaşam döngüsü testleri.

use super::*;
use sqlx::Acquire;

/// Fabrika öntanımlı PIN ile iş istasyonuna giriş
/// reddedilir; bayrağı kapalı hesap aynı kiracıda
/// normal girer.
#[tokio::test]
async fn fabrika_pin_ile_giris_reddedilir() {
    let pool = havuz().await;

    // Fabrika PIN'li hesap (must_change_pin = 1).
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("1111").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_master_test', 'tnt_test', 'MASTER', 'Test', ?, 1, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    // Aynı kiracıda bayrağı kapalı hesap.
    let hash = crate::user_credentials::hash_pin("2222").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_owner_test', 'tnt_test', 'OWNER', 'Test', ?, 1, 0)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let hata = authenticate_by_pin(&pool, "1111", Some("tnt_test"))
        .await
        .expect_err("fabrika PIN'i girmemeli");
    assert!(
        hata.starts_with("MUST_CHANGE_PIN"),
        "hata MUST_CHANGE_PIN olmalı: {hata}"
    );

    let oturum = authenticate_by_pin(&pool, "2222", Some("tnt_test"))
        .await
        .expect("bayrağı kapalı hesap girer");
    assert_eq!(oturum.id, "usr_owner_test");
}

/// PIN değişimi ilk giriş zorlamasını bitirir:
/// `pin_degisim_tx` aynı transaction'da yeni PIN'i
/// yazar ve bayrağı sıfırlar; sonrasında yeni PIN
/// girer, fabrika PIN artık çalışmaz.
#[tokio::test]
async fn pin_degisim_tx_ilk_giris_zorlamasini_bitirir() {
    let pool = havuz().await;
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("2222").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active, must_change_pin)
         VALUES ('usr_pin', 'tnt_pin', 'OWNER', 'Test', ?, 1, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let hata = authenticate_by_pin(&pool, "2222", Some("tnt_pin"))
        .await
        .expect_err("fabrika PIN'i girmemeli");
    assert!(hata.starts_with("MUST_CHANGE_PIN"), "{hata}");

    // Kullanıcı kendi PIN'ini değiştirir: mevcut PIN
    // (fabrika öntanımlı) doğrulandı, yeni PIN yazılır,
    // ilk giriş zorlaması biter.
    let mutex = tokio::sync::Mutex::new(());
    let audit_lock = crate::services::audit_service::AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("baglanti");
    let mut tx = conn.begin().await.expect("tx baslar");
    pin_degisim_tx(&mut tx, audit_lock, "usr_pin", "2222", "9876")
        .await
        .expect("pin degisimi");
    tx.commit().await.expect("commit");
    drop(conn);

    let oturum = authenticate_by_pin(&pool, "9876", Some("tnt_pin"))
        .await
        .expect("yeni PIN ile girer");
    assert_eq!(oturum.id, "usr_pin");

    let hata = authenticate_by_pin(&pool, "2222", Some("tnt_pin"))
        .await
        .expect_err("eski PIN reddedilmeli");
    assert!(
        !hata.starts_with("MUST_CHANGE_PIN"),
        "zorlama kapanmış, hata sıradan PIN hatası olmalı: {hata}"
    );
}

/// Regresyon: `pin_degisim_tx` yanlış mevcut PIN'i
/// reddeder ve rollback'den sonra eski PIN hâlâ
/// çalışır (değişim atomiktir).
#[tokio::test]
async fn pin_degisim_tx_yanlis_mevcut_pini_reddeder() {
    let pool = havuz().await;
    let mut conn = pool.acquire().await.expect("baglanti");
    let hash = crate::user_credentials::hash_pin("1234").expect("hashlenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
         VALUES ('usr_eski', 'tnt_eski', 'CASHIER', 'Test', ?, 1)",
    )
    .bind(&hash)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
    drop(conn);

    let mutex = tokio::sync::Mutex::new(());
    let audit_lock = crate::services::audit_service::AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("baglanti");
    let mut tx = conn.begin().await.expect("tx baslar");
    let sonuc = pin_degisim_tx(&mut tx, audit_lock, "usr_eski", "9999", "4321").await;
    tx.rollback().await.expect("rollback");
    drop(conn);

    assert!(sonuc.is_err(), "yanlış mevcut PIN reddedilmeli");
    let oturum = authenticate_by_pin(&pool, "1234", Some("tnt_eski"))
        .await
        .expect("eski PIN korunur");
    assert_eq!(oturum.id, "usr_eski");
}
