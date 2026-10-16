//! Kimlik doğrulama güvenlik regresyon testleri — `auth_commands` için (facade).
//!
//! Kilit artık process-global statik değil, `login_attempts` tablosundadır. Bu iki
//! şeyi birden kazanır: yeniden başlatma kilidi silmez ve testler birbirini
//! etkilemez (her test kendi bellek içi veritabanını kurar).

use super::*;
use crate::db::DbPool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub async fn havuz() -> DbPool {
    let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("gecerli baglanti secenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(secenek)
        .await
        .expect("havuz acilir");
    sqlx::raw_sql(include_str!("../../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("sema uygulanir");
    pool
}

/// Verilen e-posta ile bir kullanıcı yazar.
pub async fn kullanici_ekle(pool: &DbPool, id: &str, tenant: &str, email: &str, parola: &str) {
    let hash = crate::auth::hash_credential(parola).expect("parola hashlenir");
    let mut conn = pool.acquire().await.expect("baglanti");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, credential_hash, login_identifier, email, is_active)
         VALUES (?, ?, 'OWNER', 'Test', ?, ?, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(&hash)
    .bind(email)
    .bind(email)
    .execute(&mut *conn)
    .await
    .expect("kullanici yazilir");
}

/// PIN değiştirme mevcut PIN olmadan yapılamaz.
#[test]
fn pin_degistirme_mevcut_pinsiz_reddedilir() {
    assert!(mevcut_pin_zorunlu(None).is_err());
    assert!(mevcut_pin_zorunlu(Some("")).is_err());
    assert!(mevcut_pin_zorunlu(Some("   ")).is_err());

    // Kenarlıklar temizlenir: " 1234 " ile "1234" aynı PIN'dir.
    assert_eq!(mevcut_pin_zorunlu(Some(" 1234 ")).expect("gecerli"), "1234");

    let hata = mevcut_pin_zorunlu(None).expect_err("mevcut pin zorunlu");
    assert!(hata.starts_with("UNAUTHORIZED"), "{hata}");
}

mod lockout_tests;
mod pin_lifecycle_tests;
