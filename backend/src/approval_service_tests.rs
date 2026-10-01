//! `approval_service` testleri ayrı dosyada tutulur (AGENTS.md §10: dosya başına
//! en fazla 500 satır). Modül `#[path]` ile içeri alınır, davranış değişmez.

use super::*;
use crate::approval_service::{
    attempt_scope_for_test, MAX_FAILED_ATTEMPTS,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");

pub async fn approval_pool() -> sqlx::SqlitePool {
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
        .expect("onay şeması uygulanır");
    pool
}

pub async fn seed_user(
    pool: &sqlx::SqlitePool,
    id: &str,
    tenant: &str,
    role: &str,
    pin: &str,
    active: i64,
) {
    let hash = user_credentials::hash_pin(pin).expect("PIN hash'lenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(role)
    .bind(format!("{} {}", role, id))
    .bind(hash)
    .bind(active)
    .execute(pool)
    .await
    .expect("kullanıcı eklenir");
}

pub fn request(actor: &str, operation: &str, amount: i64) -> ApprovalRequest {
    ApprovalRequest {
        tenant_id: "tenant_a".to_string(),
        operation: operation.to_string(),
        resource_id: "ord_01".to_string(),
        actor_id: actor.to_string(),
        actor_role: "CASHIER".to_string(),
        amount_cents: amount,
        terminal_id: "term_01".to_string(),
        approved_percent_hint: 0,
    }
}

#[tokio::test]
async fn dogru_pin_jeton_uretir_ve_jeton_defterde_kayitli_approver_olarak_durur() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let verified = verify_and_issue(
        &mut conn,
        &request("usr_cashier", operation::VOID, 0),
        "2222",
    )
    .await
    .expect("işletme sahibi PIN'i onay verir");

    assert_eq!(verified.approver_id, "usr_owner");
    assert_eq!(verified.approver_role, Role::Owner);
    assert!(!verified.token.is_empty());

    let (role, amount): (String, i64) = sqlx::query_as(
        "SELECT approved_by_role, amount_cents FROM approvals WHERE approver_id = 'usr_owner'",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("onay kaydı okunur");
    assert_eq!(role, "OWNER");
    assert_eq!(amount, 0);

    // Veritabanında jetonun kendisi değil özeti saklanır.
    let stored_hash: String =
        sqlx::query_scalar("SELECT token_hash FROM approvals WHERE approver_id = 'usr_owner'")
            .fetch_one(&mut *conn)
            .await
            .expect("jeton özeti okunur");
    assert_eq!(stored_hash.len(), 64);
    assert!(!stored_hash.contains(&verified.token));
}

#[tokio::test]
async fn hatali_pin_tum_roller_icin_ayni_mesaji_dondurur() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    for _ in 0..3 {
        let err = verify_and_issue(&mut conn, &request("usr_cashier", operation::VOID, 0), "9999")
            .await
            .expect_err("hatalı PIN reddedilir");
        assert_eq!(err, error::INVALID_PIN);
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM approvals")
        .fetch_one(&mut *conn)
        .await
        .expect("onay sayısı okunur");
    assert_eq!(count, 0, "hatalı deneme deftere kayıt yazmaz");
}

#[tokio::test]
async fn kasa_garson_mutfak_pini_onay_veremez() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    seed_user(&pool, "usr_waiter", "tenant_a", "WAITER", "5555", 1).await;
    seed_user(&pool, "usr_kitchen", "tenant_a", "KITCHEN", "6666", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    for pin in ["4444", "5555", "6666"] {
        let err = verify_and_issue(&mut conn, &request("usr_owner", operation::VOID, 0), pin)
            .await
            .expect_err("kasa/garson/mutfak onaylayamaz");
        assert_eq!(err, error::NOT_APPROVER, "{}", pin);
    }
}

#[tokio::test]
async fn basta_tenant_pini_onay_veremez() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner_b", "tenant_b", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let err = verify_and_issue(&mut conn, &request("usr_cashier", operation::VOID, 0), "2222")
        .await
        .expect_err("başka tenant PIN'i reddedilir");
    assert_eq!(err, error::INVALID_PIN);
}

#[tokio::test]
async fn pasif_personel_pini_onay_veremez() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 0).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let err = verify_and_issue(&mut conn, &request("usr_cashier", operation::VOID, 0), "2222")
        .await
        .expect_err("pasif personel reddedilir");
    assert_eq!(err, error::INVALID_PIN);
}

#[tokio::test]
async fn bes_hatali_deneden_sonra_terminal_kilitlenir_ve_kayit_kalici_yazilir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    for _ in 0..MAX_FAILED_ATTEMPTS {
        let _ = verify_and_issue(&mut conn, &request("usr_cashier", operation::VOID, 0), "9999")
            .await;
    }

    // Kilit artık doğru PIN'i de reddediyor.
    let err = verify_and_issue(&mut conn, &request("usr_cashier", operation::VOID, 0), "2222")
        .await
        .expect_err("kilitliyken doğru PIN de reddedilir");
    assert!(err.starts_with("APPROVAL_LOCKED"), "{}", err);

    let scope = attempt_scope_for_test("tenant_a", "term_01", operation::VOID);
    let counter = sqlx::query(
        "SELECT failed_count, locked_until FROM approval_attempts WHERE scope = ? AND tenant_id = ?",
    )
    .bind(&scope)
    .bind("tenant_a")
    .fetch_one(&mut *conn)
    .await
    .expect("sayaç satırı okunur");
    let failed: i64 = counter.try_get("failed_count").expect("sayaç okunur");
    let locked: Option<String> = counter.try_get("locked_until").expect("kilit okunur");
    assert_eq!(failed, 0, "kilit açıldığında sayaç sıfırlanır");
    assert!(locked.is_some(), "kilit veritabanına yazılır");
}

#[tokio::test]
async fn baska_terminalin_sayaci_etkilenmez() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    for _ in 0..MAX_FAILED_ATTEMPTS {
        let locked_request = ApprovalRequest {
            terminal_id: "term_01".to_string(),
            ..request("usr_cashier", operation::VOID, 0)
        };
        let _ = verify_and_issue(&mut conn, &locked_request, "9999").await;
    }

    let other = ApprovalRequest {
        terminal_id: "term_02".to_string(),
        ..request("usr_cashier", operation::VOID, 0)
    };
    verify_and_issue(&mut conn, &other, "2222")
        .await
        .expect("başka terminal kilitlenmez");
}

#[tokio::test]
async fn self_approval_yasaktir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_manager", "tenant_a", "MANAGER", "3333", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Müdür kendi işlemini onaylamaya çalışıyor.
    let err = verify_and_issue(
        &mut conn,
        &request("usr_manager", operation::VOID, 0),
        "3333",
    )
    .await
    .expect_err("kendi işlemini onaylayamaz");
    assert_eq!(err, error::SELF_APPROVAL);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM approvals")
        .fetch_one(&mut *conn)
        .await
        .expect("onay sayısı okunur");
    assert_eq!(count, 0, "kendi onayı deftere yazılmaz");
}

#[tokio::test]
async fn her_tutarda_indirim_icin_onay_zorunlu_ve_ust_rol_yeterlidir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_manager", "tenant_a", "MANAGER", "3333", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // 1 TL indirim bile onay ister.
    let small = ApprovalRequest {
        amount_cents: 100,
        approved_percent_hint: 1,
        ..request("usr_cashier", operation::DISCOUNT, 0)
    };
    assert!(!requires_privileged_approver(&small));

    // Kasa küçük indirimi de onaylayamaz: K1'de onaylayan roller kapalı.
    let err = verify_and_issue(&mut conn, &small, "4444")
        .await
        .expect_err("kasa onay veremez");
    assert_eq!(err, error::NOT_APPROVER);

    let verified = verify_and_issue(&mut conn, &small, "3333")
        .await
        .expect("müdür küçük indirimi onaylar");
    assert_eq!(verified.approver_role, Role::Manager);
    consume_token(&mut conn, &verified.token, &small)
        .await
        .expect("jeton tüketilir");
}

#[tokio::test]
async fn buyuk_indirimde_kasa_onaylayamaz_ustelik_master_da() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    seed_user(&pool, "usr_manager", "tenant_a", "MANAGER", "3333", 1).await;
    seed_user(&pool, "usr_master", "tenant_a", "MASTER", "1111", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // %25 indirim: yalnız işletme sahibi veya müdür onaylar.
    let percent_case = ApprovalRequest {
        amount_cents: 2_500,
        approved_percent_hint: 25,
        ..request("usr_cashier", operation::DISCOUNT, 0)
    };
    assert!(requires_privileged_approver(&percent_case));

    let err = verify_and_issue(&mut conn, &percent_case, "4444")
        .await
        .expect_err("kasa büyük indirimi onaylayamaz");
    assert_eq!(err, error::NOT_APPROVER);

    let err = verify_and_issue(&mut conn, &percent_case, "1111")
        .await
        .expect_err("MASTER büyük indirimi onaylayamaz");
    assert_eq!(err, error::NOT_APPROVER);

    verify_and_issue(&mut conn, &percent_case, "3333")
        .await
        .expect("müdür büyük indirimi onaylar");

    // Tutar eşiği de aynı sonucu verir (600 TL).
    let amount_case = ApprovalRequest {
        amount_cents: 60_000,
        approved_percent_hint: 5,
        ..request("usr_cashier", operation::DISCOUNT, 0)
    };
    assert!(requires_privileged_approver(&amount_case));
}

#[tokio::test]
async fn ikram_daima_yuksek_esiktedir_ve_kasa_onaylayamaz() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let complimentary = ApprovalRequest {
        amount_cents: 4_600,
        approved_percent_hint: 100,
        ..request("usr_cashier", operation::COMPLIMENTARY, 0)
    };
    assert!(requires_privileged_approver(&complimentary));

    let err = verify_and_issue(&mut conn, &complimentary, "4444")
        .await
        .expect_err("kasa ikram onaylayamaz");
    assert_eq!(err, error::NOT_APPROVER);

    verify_and_issue(&mut conn, &complimentary, "2222")
        .await
        .expect("işletme sahibi ikramı onaylar");
}

#[tokio::test]
async fn void_yuzeyinde_ek_esik_yoktur_usta_roller_her_zaman_onaylayabilir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_master", "tenant_a", "MASTER", "1111", 1).await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let void_request = request("usr_cashier", operation::VOID, 999_999);
    assert!(!requires_privileged_approver(&void_request));

    verify_and_issue(&mut conn, &void_request, "1111")
        .await
        .expect("MASTER void onaylayabilir");
    verify_and_issue(&mut conn, &void_request, "2222")
        .await
        .expect("işletme sahibi void onaylayabilir");
}

#[cfg(test)]
#[path = "approval_token_tests.rs"]
mod token_tests;
