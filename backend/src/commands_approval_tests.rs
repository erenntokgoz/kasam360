//! `void_order` onay kapısı testleri (B2).
//!
//! Kural: iptal, tek kullanımlık onay jetonu olmadan **çalışmaz**. Kapı
//! `require_void_approval` içinde durur; burada onun sözleşmesi denetlenir.

use super::{require_void_approval, void_approval_request};
use crate::approval_service::{self, error, operation};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");
const TENANT: &str = "tenant_a";
const ORDER_ID: &str = "ord_01";
const CASHIER: &str = "usr_cashier";

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

async fn seed_user(pool: &sqlx::SqlitePool, id: &str, role: &str, pin: &str) {
    let hash = crate::user_credentials::hash_pin(pin).expect("PIN hash'lenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
         VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(role)
    .bind(id)
    .bind(hash)
    .execute(pool)
    .await
    .expect("kullanıcı eklenir");
}

/// Komutun kullandığı istek kapsamı. Tutar veritabanındaki siparişten gelir.
fn request(actor: &str, amount: i64) -> approval_service::ApprovalRequest {
    void_approval_request(TENANT, ORDER_ID, amount, actor, "CASHIER")
}

#[tokio::test]
async fn jetonsuz_iptal_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    for token in [None, Some(""), Some("   ")] {
        let err = require_void_approval(&mut conn, &request(CASHIER, 12_000), token).await
            .expect_err("jetonsuz iptal reddedilmeli");
        assert_eq!(err, error::TOKEN_REQUIRED);
    }
}

#[tokio::test]
async fn dogru_jeton_iptali_acitir_ve_tuketilir() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("müdür iptali onaylar");

    let approver = require_void_approval(&mut conn, &req, Some(&verified.token)).await
        .expect("jeton iptali açar");
    assert_eq!(approver.approver_id, "usr_manager");

    // Aynı jeton ikinci kez kullanılamaz: iptal iki kez yürütülemez.
    let err = require_void_approval(&mut conn, &req, Some(&verified.token)).await
        .expect_err("jeton tekrar kullanılamaz");
    assert_eq!(err, error::TOKEN_USED);
}

#[tokio::test]
async fn kasa_jetonu_baska_adisyonda_kullanilamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");

    let other_order = void_approval_request(TENANT, "ord_02", 12_000, CASHIER, "CASHIER");
    let err = require_void_approval(&mut conn, &other_order, Some(&verified.token)).await
        .expect_err("jeton başka adisyona taşınamaz");
    assert_eq!(err, error::TOKEN_SCOPE);
}

#[tokio::test]
async fn kasa_jetonu_baska_tutara_tasinamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");

    // Tutar istemciden değil sipariş satırından okunur; satır değişmişse
    // eski onay geçerli olmaz.
    let changed = void_approval_request(TENANT, ORDER_ID, 99_000, CASHIER, "CASHIER");
    let err = require_void_approval(&mut conn, &changed, Some(&verified.token)).await
        .expect_err("jeton eski tutara bağlıdır");
    assert_eq!(err, error::TOKEN_SCOPE);
}

#[tokio::test]
async fn baska_kisinin_jetonu_ile_iptal_edilemez() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let owner_req = request("usr_owner", 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &owner_req, "3333")
        .await
        .expect("onay verilir");

    // Jeton işlemi yapan kişiye göre üretilmiştir; kasa onu kullanamaz.
    let cashier_req = request(CASHIER, 12_000);
    let err = require_void_approval(&mut conn, &cashier_req, Some(&verified.token)).await
        .expect_err("jeton sahibinden başkası kullanamaz");
    assert_eq!(err, error::TOKEN_SCOPE);
}

#[tokio::test]
async fn self_approval_iptalde_engellenir() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_manager", 12_000);
    let err = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect_err("kendi iptalini onaylayamaz");
    assert_eq!(err, error::SELF_APPROVAL);
}

#[tokio::test]
async fn kasa_iptal_onaylayamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_cashier", "CASHIER", "4444").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_waiter", 12_000);
    let err = approval_service::verify_and_issue(&mut conn, &req, "4444")
        .await
        .expect_err("kasa iptal onaylayamaz");
    assert_eq!(err, error::NOT_APPROVER);
}

#[tokio::test]
async fn mutfak_ve_kasa_onaylayici_olarak_kabul_edilmez() {
    let pool = pool().await;
    seed_user(&pool, "usr_kitchen", "KITCHEN", "6666").await;
    seed_user(&pool, "usr_cashier_b", "CASHIER", "5555").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Onaylayan havuzun dışındaki roller aynı hatayı alır: PIN'e dair bilgi
    // sızmaz, yalnız yetkisizlik bildirilir.
    for (id, pin) in [("usr_kitchen", "6666"), ("usr_cashier_b", "5555")] {
        let req = request("usr_waiter", 12_000);
        let err = approval_service::verify_and_issue(&mut conn, &req, pin)
            .await
            .expect_err("onaylayan havuz dışında");
        assert_eq!(err, error::NOT_APPROVER, "{} reddedilmeli", id);
    }
}

#[tokio::test]
async fn isletme_sahibi_ve_mudur_iptali_onaylayabilir() {
    let pool = pool().await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    seed_user(&pool, "usr_master", "MASTER", "1111").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // K1: onaylayan üst üç rol. Void yüzeyinde ek eşik yoktur.
    for (id, pin) in [
        ("usr_owner", "2222"),
        ("usr_manager", "3333"),
        ("usr_master", "1111"),
    ] {
        let req = request(CASHIER, 12_000);
        let verified = approval_service::verify_and_issue(&mut conn, &req, pin)
            .await
            .unwrap_or_else(|err| panic!("{} onaylayamadı: {}", id, err));
        require_void_approval(&mut conn, &req, Some(&verified.token)).await
            .unwrap_or_else(|err| panic!("{} jetonu kabul edilmedi: {}", id, err));
    }
}

#[tokio::test]
async fn sure_dolmus_jeton_iptali_acmaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");

    let expired = (chrono::Utc::now()
        - chrono::Duration::seconds(approval_service::TOKEN_TTL_SECONDS + 1))
    .to_rfc3339();
    sqlx::query("UPDATE approvals SET expires_at = ? WHERE resource_id = ?")
        .bind(expired)
        .bind(ORDER_ID)
        .execute(&mut *conn)
        .await
        .expect("süre düzenlenir");

    let err = require_void_approval(&mut conn, &req, Some(&verified.token)).await
        .expect_err("süresi dolmuş jeton reddedilmeli");
    assert_eq!(err, error::TOKEN_EXPIRED);
}

#[tokio::test]
async fn baska_tenantin_jetonu_iptali_acmaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");

    let other_tenant = void_approval_request("tenant_b", ORDER_ID, 12_000, CASHIER, "CASHIER");
    let err = require_void_approval(&mut conn, &other_tenant, Some(&verified.token)).await
        .expect_err("çapraz tenant jetonu reddedilmeli");
    assert_eq!(err, error::TOKEN_INVALID);
}

#[tokio::test]
async fn islem_yapan_kisi_jeton_sahibiyle_eslesmelidir() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request(CASHIER, 12_000);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");
    require_void_approval(&mut conn, &req, Some(&verified.token)).await
        .expect("jeton tüketilir");

    // Tüketim kaydı approver ve operation ile birlikte rapor için kalıcıdır.
    let row = sqlx::query(
        "SELECT approver_id, approved_by_role, request_type, consumed_at FROM approvals",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("onay kaydı okunur");
    assert_eq!(row.try_get::<String, _>("approver_id").unwrap(), "usr_manager");
    assert_eq!(row.try_get::<String, _>("approved_by_role").unwrap(), "MANAGER");
    assert_eq!(row.try_get::<String, _>("request_type").unwrap(), operation::VOID);
    assert!(row
        .try_get::<Option<String>, _>("consumed_at")
        .unwrap()
        .is_some());
}
