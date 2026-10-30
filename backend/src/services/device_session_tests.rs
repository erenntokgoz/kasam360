//! Hesap oturumu kapısı, kalıcı ve geçici oturum, personel kilit ayarı.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::query(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO users (id, tenant_id, role, name, email, credential_hash)
            VALUES ('usr_1', 'tnt_a', 'OWNER', 'Sahip', 'a@b.co', 'hash');",
    )
    .execute(&pool)
    .await
    .expect("sahip");
    pool
}

async fn session(pool: &SqlitePool) -> DeviceSession {
    let mut conn = pool.acquire().await.expect("bağlantı");
    load(&mut conn).await.expect("oturum")
}

async fn signed_in(pool: &SqlitePool) {
    let mut conn = pool.acquire().await.expect("bağlantı");
    sign_in(&mut conn, "usr_1", "tnt_a").await.expect("giriş");
}

#[tokio::test]
async fn hesap_girisi_olmadan_personel_kapisi_kapali() {
    let pool = pool().await;
    assert!(require_signed_in(&pool)
        .await
        .expect_err("kapı")
        .starts_with("ACCOUNT_REQUIRED"));
    signed_in(&pool).await;
    require_signed_in(&pool).await.expect("açık");
    assert_eq!(session(&pool).await.email.as_deref(), Some("a@b.co"));
}

#[tokio::test]
async fn varsayilan_oturum_yeniden_acilista_surer() {
    let pool = pool().await;
    signed_in(&pool).await;
    end_temporary_session(&pool).await.expect("açılış");
    assert!(session(&pool).await.signed_in);
}

#[tokio::test]
async fn gecici_oturum_yeniden_acilista_biter_ayar_korunur() {
    let pool = pool().await;
    signed_in(&pool).await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    set_policy(&mut conn, false, 0).await.expect("ayar");
    drop(conn);
    assert!(session(&pool).await.signed_in);

    end_temporary_session(&pool).await.expect("açılış");

    let after = session(&pool).await;
    assert!(!after.signed_in);
    assert!(!after.keep_signed_in);
    assert_eq!(after.staff_idle_seconds, 0);
}

#[tokio::test]
async fn pasif_hesabin_oturumu_gecersizdir() {
    let pool = pool().await;
    signed_in(&pool).await;
    sqlx::query("UPDATE users SET is_active = 0 WHERE id = 'usr_1'")
        .execute(&pool)
        .await
        .expect("pasif");
    assert!(!session(&pool).await.signed_in);
}

#[tokio::test]
async fn sahibin_sifresi_yoksa_hesap_eksik_gorunur() {
    let pool = pool().await;
    assert!(!session(&pool).await.account_missing);
    sqlx::query("UPDATE users SET credential_hash = NULL")
        .execute(&pool)
        .await
        .expect("eski işletme");
    assert!(session(&pool).await.account_missing);
}

#[tokio::test]
async fn gecersiz_kilit_suresi_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(set_policy(&mut conn, true, 7).await.is_err());
}

#[test]
fn eposta_ve_sifre_kurallari() {
    assert_eq!(
        normalize_email(" Ali@Ornek.COM ").as_deref(),
        Ok("ali@ornek.com")
    );
    for bad in ["", "ali", "ali@", "@a.co", "a@b", "a b@c.co", "a@b@c.co"] {
        assert!(normalize_email(bad).is_err(), "{bad}");
    }
    assert!(validate_password("1234567").is_err());
    assert!(validate_password("12345678").is_ok());
}
