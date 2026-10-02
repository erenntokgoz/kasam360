//! `payment_approval` testleri (B2). Modül `#[path]` ile içeri alınır.
//!
//! Bu dosya iş kuralını değil **kapının kendisini** test eder: indirim varsa
//! jeton zorunlu mudur, yüzey nasıl belirlenir, eşik kuralı tüketim anında da
//! uygulanıyor mu.

use super::*;
use crate::approval_service::{self, ApprovalRequest};
use crate::repositories::payment_repository::{PaymentRepository, ServerTruth};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

/// Testlerde kullanılan sözleşme sabitleri: komut tarafıyla birebir aynı
/// kaynak (tenant, adisyon, fiş) üzerinden üretilir.
const TENANT: &str = "tenant_a";
const CASHIER: &str = "usr_cashier";
const TRANSACTION: &str = "txn_01";

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
    seed_user_in(pool, id, TENANT, role, pin).await;
}

async fn seed_user_in(
    pool: &sqlx::SqlitePool,
    id: &str,
    tenant: &str,
    role: &str,
    pin: &str,
) {
    let hash = crate::user_credentials::hash_pin(pin).expect("PIN hash'lenir");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
         VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(role)
    .bind(id)
    .bind(hash)
    .execute(pool)
    .await
    .expect("kullanıcı eklenir");
}

/// Sunucu hesabının bir dökümünü doğrudan kurar: test, sepet hesabını değil
/// **karar kuralını** denetlemelidir.
fn truth(subtotal: i64, tax: i64, discount: i64, gross: i64) -> ServerTruth {
    ServerTruth {
        subtotal_cents: subtotal,
        tax_cents: tax,
        discount_cents: discount,
        gross_cents: gross,
        total_cents: (subtotal + tax - discount).max(0),
    }
}

fn discount_truth(discount: i64) -> ServerTruth {
    truth(10_000, 1_000, discount, 11_000)
}

/// Testler için denetim kilidi. Üretimde bu kilidi `AppState`'in `audit_mutex`'i
/// verir; testte çağıranın kendi mutex'ü kullanılır.
async fn lock_for<'a>(mutex: &'a tokio::sync::Mutex<()>) -> AuditLock<'a> {
    AuditLock::new(mutex.lock().await)
}

async fn consume<'a>(
    conn: &'a mut sqlx::SqliteConnection,
    audit_lock: &'a AuditLock<'_>,
    server_truth: &ServerTruth,
    token: Option<&str>,
) -> Result<Option<ConsumedApproval>, String> {
    consume_discount_approval(
        conn,
        audit_lock,
        TENANT,
        CASHIER,
        "CASHIER",
        TRANSACTION,
        server_truth,
        token,
    )
    .await
}

#[tokio::test]
async fn indirim_yoksa_onay_yuzesi_acilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let server_truth = truth(10_000, 1_000, 0, 11_000);
    // Jeton yok: indirim de yoksa hata **yok**.
    assert!(consume_without_audit(&mut conn, &server_truth, None)
        .await
        .is_ok());
}

/// Denetim kilidi isteyen yolun test yardımcısı: gerçek bir kilit üretir.
async fn consume_without_audit(
    conn: &mut sqlx::SqliteConnection,
    server_truth: &ServerTruth,
    token: Option<&str>,
) -> Result<Option<ConsumedApproval>, String> {
    // `consume_discount_approval` erken döndüğünde kilide dokunmaz; testte
    // güvenli bir kilit gerektiği için gerçek bir kilit üretilir.
    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;
    consume(conn, &audit_lock, server_truth, token).await
}

#[tokio::test]
async fn her_tutardaki_indirim_jetonsuz_gecmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // 100 kuruşluk indirim de onay ister: K2 "her tutarda onay" der.
    let err = consume_without_audit(&mut conn, &discount_truth(100), None)
        .await
        .expect_err("jetonsuz indirim reddedilmeli");
    assert_eq!(err, approval_service::error::TOKEN_REQUIRED);

    // Boş string jeton da "yok" sayılır.
    let err = consume_without_audit(&mut conn, &discount_truth(100), Some("   "))
        .await
        .expect_err("boş jeton reddedilmeli");
    assert_eq!(err, approval_service::error::TOKEN_REQUIRED);
}

#[tokio::test]
async fn dogru_jeton_indirimi_acitir_ve_guvenlik_kaydi_yazar() {
    let pool = pool().await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let server_truth = discount_truth(1_500);
    let issue = ApprovalRequest {
        tenant_id: TENANT.to_string(),
        operation: operation::DISCOUNT.to_string(),
        resource_id: TRANSACTION.to_string(),
        actor_id: CASHIER.to_string(),
        actor_role: "CASHIER".to_string(),
        amount_cents: 1_500,
        approved_percent_hint: 14,
        terminal_id: "terminal_payment".to_string(),
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "2222")
        .await
        .expect("işletme sahibi indirimi onaylar");

    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;

    let consumed = consume(&mut conn, &audit_lock, &server_truth, Some(&verified.token))
        .await
        .expect("jeton tüketilir")
        .expect("onay döner");
    assert_eq!(consumed.operation, operation::DISCOUNT);
    assert_eq!(consumed.approver_id, "usr_owner");
    assert_eq!(consumed.amount_cents, 1_500);

    let row = sqlx::query(
        "SELECT action, category, actor_id FROM audit_ledger WHERE action = 'approval:consumed'",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("güvenlik kaydı yazılır");
    assert_eq!(row.try_get::<String, _>("category").unwrap(), category::GUVENLIK);
    assert_eq!(row.try_get::<String, _>("actor_id").unwrap(), "usr_owner");
}

#[tokio::test]
async fn ikram_yuzeyi_yuzde_yuz_indirimden_turetilir() {
    let pool = pool().await;
    seed_user(&pool, "usr_manager", "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // %100 indirim: brüt 11.000, indirim 11.000, tahsilat sıfır.
    let complimentary = truth(10_000, 1_000, 11_000, 11_000);
    assert_eq!(complimentary.total_cents, 0);
    assert_eq!(operation_for_truth(&complimentary), operation::COMPLIMENTARY);

    let issue = ApprovalRequest {
        operation: operation::COMPLIMENTARY.to_string(),
        amount_cents: 11_000,
        approved_percent_hint: 100,
        ..issue_base()
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "3333")
        .await
        .expect("müdür ikramı onaylar");

    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;
    let consumed = consume(&mut conn, &audit_lock, &complimentary, Some(&verified.token))
        .await
        .expect("jeton tüketilir")
        .expect("onay döner");
    assert_eq!(consumed.operation, operation::COMPLIMENTARY);
}

#[tokio::test]
async fn kasa_ikrami_onaylayamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_cashier", "CASHIER", "4444").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let issue = ApprovalRequest {
        operation: operation::COMPLIMENTARY.to_string(),
        amount_cents: 11_000,
        approved_percent_hint: 100,
        ..issue_base()
    };

    let err = approval_service::verify_and_issue(&mut conn, &issue, "4444")
        .await
        .expect_err("kasa ikram onaylayamaz");
    assert_eq!(err, approval_service::error::NOT_APPROVER);
}

#[tokio::test]
async fn buyuk_indirimde_master_jetonu_tuketilemez() {
    let pool = pool().await;
    seed_user(&pool, "usr_master", "MASTER", "1111").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Küçük bir indirim için MASTER onayı üretilebilir...
    let small = ApprovalRequest {
        operation: operation::DISCOUNT.to_string(),
        amount_cents: 500,
        approved_percent_hint: 5,
        ..issue_base()
    };
    let verified = approval_service::verify_and_issue(&mut conn, &small, "1111")
        .await
        .expect("MASTER küçük indirimi onaylar");

    // ...ama aynı jeton büyük bir indirimde kullanılamaz: kapsam tutarı
    // bağladığı için zaten reddedilir.
    let err = consume_without_audit(&mut conn, &discount_truth(6_000), Some(&verified.token))
        .await
        .expect_err("başka tutara taşınamaz");
    assert_eq!(err, approval_service::error::TOKEN_SCOPE);
}

#[tokio::test]
async fn self_approval_indirim_yolunda_da_engellenir() {
    let pool = pool().await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let issue = ApprovalRequest {
        operation: operation::DISCOUNT.to_string(),
        amount_cents: 1_000,
        approved_percent_hint: 9,
        actor_id: "usr_owner".to_string(),
        ..issue_base()
    };
    let err = approval_service::verify_and_issue(&mut conn, &issue, "2222")
        .await
        .expect_err("kendi indirimini onaylayamaz");
    assert_eq!(err, approval_service::error::SELF_APPROVAL);
}

#[tokio::test]
async fn baska_tenantin_jetonu_indirim_yolunda_kullanilamaz() {
    let pool = pool().await;
    seed_user_in(&pool, "usr_owner_b", "tenant_b", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let issue = ApprovalRequest {
        tenant_id: "tenant_b".to_string(),
        operation: operation::DISCOUNT.to_string(),
        amount_cents: 1_000,
        approved_percent_hint: 9,
        ..issue_base()
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "2222")
        .await
        .expect("tenant_b sahibi onaylar");

    // Aynı jeton tenant_a'nın ödemesinde kullanılamaz.
    let err = consume_without_audit(&mut conn, &discount_truth(1_000), Some(&verified.token))
        .await
        .expect_err("çapraz tenant jetonu reddedilir");
    assert_eq!(err, approval_service::error::TOKEN_INVALID);
}

#[tokio::test]
async fn jeton_iki_kez_kullanilamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let server_truth = discount_truth(1_000);
    let issue = ApprovalRequest {
        operation: operation::DISCOUNT.to_string(),
        amount_cents: 1_000,
        approved_percent_hint: 9,
        ..issue_base()
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "2222")
        .await
        .expect("onay verilir");

    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;

    consume(&mut conn, &audit_lock, &server_truth, Some(&verified.token))
        .await
        .expect("ilk kullanım");
    let err = consume(&mut conn, &audit_lock, &server_truth, Some(&verified.token))
        .await
        .expect_err("jeton tekrar kullanılamaz");
    assert_eq!(err, approval_service::error::TOKEN_USED);
}

#[tokio::test]
async fn baska_fiis_icin_alinan_jeton_baska_fise_tasinamaz() {
    let pool = pool().await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let issue = ApprovalRequest {
        operation: operation::DISCOUNT.to_string(),
        amount_cents: 1_000,
        approved_percent_hint: 9,
        ..issue_base()
    };
    let verified = approval_service::verify_and_issue(&mut conn, &issue, "2222")
        .await
        .expect("onay verilir");

    let other_txn = ApprovalRequest {
        resource_id: "txn_02".to_string(),
        amount_cents: 1_000,
        approved_percent_hint: 9,
        ..issue_base()
    };
    let err = consume_for(
        &mut conn,
        "txn_02",
        &discount_truth(1_000),
        Some(&verified.token),
        &other_txn,
    )
    .await
    .expect_err("başka fişe taşınamaz");
    assert_eq!(err, approval_service::error::TOKEN_SCOPE);
}

#[tokio::test]
async fn esik_kurali_tuketim_aninda_tekrar_denetlenir() {
    let pool = pool().await;
    seed_user(&pool, "usr_master", "MASTER", "1111").await;
    seed_user(&pool, "usr_owner", "OWNER", "2222").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Elde yazılmış bir onay satırı: MASTER onaylı, büyük indirim. Tüketim
    // yolundaki ikinci denetim, üretim yolu atlanmış olsa bile reddetmelidir.
    let forged_token = "elle_yazilmis_jeton";
    sqlx::query(
        "INSERT INTO approvals
            (id, tenant_id, request_type, resource_id, requester_id, status, approver_id,
             approved_by_role, amount_cents, token_hash, expires_at, payload, created_at, resolved_at)
         VALUES ('apr_x', ?, 'DISCOUNT', ?, ?, 'APPROVED', 'usr_master', 'MASTER', 6000, ?, ?, '{}', datetime('now'), datetime('now'))",
    )
    .bind(TENANT)
    .bind(TRANSACTION)
    .bind(CASHIER)
    .bind(approval_service::test_hash_hex(forged_token))
    .bind((chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339())
    .execute(&mut *conn)
    .await
    .expect("onay satırı yazılır");

    // Büyük indirim yüzeyinde MASTER'ın jetonu kabul edilmez.
    let err = consume_without_audit(&mut conn, &discount_truth(6_000), Some(forged_token))
        .await
        .expect_err("büyük indirimde MASTER reddedilmeli");
    assert_eq!(err, approval_service::error::APPROVER_NOT_ALLOWED);

    // Reddedilen işlem jetonu **tüketmez** (denetim tüketimden önce çalışır).
    // Aynı satır küçük indirim yüzeyinde kabul edilir: reddedilen şey onaylayan
    // değil, onaylayanın o işlem için yetkiz olmasıdır.
    sqlx::query("UPDATE approvals SET amount_cents = 500 WHERE id = 'apr_x'")
        .execute(&mut *conn)
        .await
        .expect("tutar düzeltilir");
    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;
    let consumed = consume(&mut conn, &audit_lock, &discount_truth(500), Some(forged_token))
        .await
        .expect("küçük indirimde MASTER onayı geçerli")
        .expect("onay döner");
    assert_eq!(consumed.approver_role, "MASTER");

    // Doğru jetonla üretilmiş büyük indirimde MASTER reddedilir: bu, üretim
    // yolunda zaten engellenir; tüketim yolundaki ikinci denetimin kuralı
    // `approver_roles_for` ile görünür.
    assert_eq!(
        approver_roles_for(operation::DISCOUNT, 25, 6_000),
        vec![crate::rbac::Role::Owner, crate::rbac::Role::Manager]
    );
    assert_eq!(
        approver_roles_for(operation::DISCOUNT, 5, 400),
        crate::rbac::APPROVER_ROLES.to_vec()
    );
}

#[tokio::test]
async fn yuzde_hesabi_brut_tutardan_turetilir() {
    // 11.000 brüt, 1.100 indirim → %10
    assert_eq!(discount_percent_for_test(&discount_truth(1_100)), 10);
    // 11.000 brüt, 2.750 indirim → %25 (yuvarlanmış)
    assert_eq!(discount_percent_for_test(&discount_truth(2_750)), 25);
    // Brüt sıfırken bölme hatası yapılmaz.
    assert_eq!(discount_percent_for_test(&truth(0, 0, 0, 0)), 0);
}

/// Ortak istek iskeleti. Alanlar tek tek yazılırsa testler yanlış kapsamı
/// (yanlış tenant, yanlış fiş) sessizce geçebilir.
fn issue_base() -> ApprovalRequest {
    ApprovalRequest {
        tenant_id: TENANT.to_string(),
        operation: operation::DISCOUNT.to_string(),
        resource_id: TRANSACTION.to_string(),
        actor_id: CASHIER.to_string(),
        actor_role: "CASHIER".to_string(),
        amount_cents: 0,
        approved_percent_hint: 0,
        terminal_id: "terminal_payment".to_string(),
    }
}

/// Farklı bir fiş kimliğiyle tüketim denemesi (kapsam sızıntısı testi).
async fn consume_for(
    conn: &mut sqlx::SqliteConnection,
    resource_id: &str,
    server_truth: &ServerTruth,
    token: Option<&str>,
    issue_for: &ApprovalRequest,
) -> Result<Option<ConsumedApproval>, String> {
    // Tüketim isteği, üretim isteğinden bağımsız kurulur: kapsam denetimi
    // yalnız veritabanındaki satırla karşılaştırır.
    let request = ApprovalRequest {
        resource_id: resource_id.to_string(),
        amount_cents: issue_for.amount_cents,
        approved_percent_hint: issue_for.approved_percent_hint,
        ..issue_base()
    };
    assert_eq!(request.resource_id, "txn_02");

    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;
    consume_discount_approval(
        conn,
        &audit_lock,
        &request.tenant_id,
        &request.actor_id,
        &request.actor_role,
        &request.resource_id,
        server_truth,
        token,
    )
    .await
}

/// `calculate_server_truth` gerçekten indirim tutarını üretiyorsa kapıya girer;
/// bu test sepet hesabı ile onay kapısının birbirine bağlandığını kanıtlar.
#[tokio::test]
async fn sunucu_hesabindaki_indirim_kapiyi_acitir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    sqlx::query(
        "INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', ?, 'Test')",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await
    .expect("kategori eklenir");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate, category_id)
         VALUES ('prd_1', ?, 'Test Ürün', 10000, 10.0, 'cat_1')",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await
    .expect("ürün eklenir");

    let items = vec![crate::commands::CartItemDto {
        id: "itm_1".to_string(),
        product: serde_json::json!({ "id": "prd_1" }),
        quantity: 1,
        unit_price: 10_000,
        tax_rate: Some(10),
        subtotal: None,
        tax_amount: None,
        total: None,
        modifiers: None,
        note: None,
        discount: Some(serde_json::json!({ "type": "PERCENTAGE", "value": 50.0 })),
    }];

    let truth = PaymentRepository::calculate_server_truth(&mut conn, TENANT, &items, None)
        .await
        .expect("sunucu hesabı çalışır");
    assert!(truth.discount_cents > 0, "indirim hesaplanmalı");
    assert_eq!(operation_for_truth(&truth), operation::DISCOUNT);

    // Jetonsuz bu gerçek indirim kapatılır.
    let err = consume_without_audit(&mut conn, &truth, None)
        .await
        .expect_err("gerçek indirim jetonsuz geçmemeli");
    assert_eq!(err, approval_service::error::TOKEN_REQUIRED);
}
