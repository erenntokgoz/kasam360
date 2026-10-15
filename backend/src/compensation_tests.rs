//! Compensation void + refund + conflict tests (G5).
//!
//! `create_compensation_void` / `create_compensation_refund` `#[tauri::command]`
//! fonksiyonları `tauri::State` alır; burada onların kullandığı `require_void_approval`
//! onay katmanı ve `refunds` / `conflict_log` tabloları doğrudan sınanır.

use crate::approval_service::{self, error, operation, ApprovalRequest};
use crate::commands::void_commands::{require_void_approval, void_approval_request};
use crate::services::audit_service::category;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");
const TENANT: &str = "tenant_a";
const OTHER_TENANT: &str = "tenant_b";
const ORDER_ID: &str = "ord_cvp_01";
const TXN_ID: &str = "txn_cvp_01";
const CASHIER: &str = "usr_cashier";
const MANAGER: &str = "usr_manager";

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

/// REFUND scope'lu onay isteği.
fn refund_request(actor: &str, amount: i64, resource_id: &str) -> ApprovalRequest {
    ApprovalRequest {
        tenant_id: TENANT.to_string(),
        operation: operation::REFUND.to_string(),
        resource_id: resource_id.to_string(),
        actor_id: actor.to_string(),
        actor_role: "CASHIER".to_string(),
        amount_cents: amount,
        approved_percent_hint: 0,
        terminal_id: crate::id_generator::generate_terminal_id(),
    }
}

/// Siparişi PAID durumunda seed'ler. tables tablosu da yaratılır (FK).
async fn seed_paid_order(pool: &sqlx::SqlitePool, order_id: &str, total_cents: i64) {
    // Masanın var olduğunu varsay: orders.tab_id → tables.id FK.
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name) VALUES ('tbl_1', ?, 'Masa 1')")
        .bind(TENANT)
        .execute(pool)
        .await
        .expect("masa eklenir");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at, updated_at)
         VALUES (?, ?, ?, 'PAID', ?, datetime('now'), datetime('now'))",
    )
    .bind(order_id)
    .bind(TENANT)
    .bind("tbl_1")
    .bind(total_cents)
    .execute(pool)
    .await
    .expect("PAID sipariş eklenir");
}

// ============================================================================
// 1. REFUND ONAYI SÜRECİ (approval_service + require_void_approval)
// ============================================================================

#[tokio::test]
async fn refund_token_approver_id_ve_rolunu_tasinir() {
    let pool = pool().await;
    seed_user(&pool, MANAGER, "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = refund_request(CASHIER, 15_000, ORDER_ID);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("müdür refund'ı onaylar");

    let approver = require_void_approval(&mut conn, &req, Some(&verified.token))
        .await
        .expect("token tüketilir");
    assert_eq!(approver.approver_id, MANAGER);
    assert_eq!(approver.approver_role.as_str(), "MANAGER");
}

#[tokio::test]
async fn refund_token_baska_operation_scope_da_kullanilamaz() {
    let pool = pool().await;
    seed_user(&pool, MANAGER, "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // VOID scope'lu token oluştur
    let void_req = void_approval_request(TENANT, "ord_void", 10_000, CASHIER, "CASHIER");
    let verified = approval_service::verify_and_issue(&mut conn, &void_req, "3333")
        .await
        .expect("müdür void'ı onaylar");

    // Aynı token REFUND scope'lu isteğe karşı.
    let refund_req = refund_request(CASHIER, 10_000, "ord_void");
    let err = require_void_approval(&mut conn, &refund_req, Some(&verified.token))
        .await
        .expect_err("farklı scope'ta token kullanılamaz");
    assert_eq!(err, error::TOKEN_SCOPE);
}

#[tokio::test]
async fn refund_token_tekrar_tuketilemez() {
    let pool = pool().await;
    seed_user(&pool, MANAGER, "MANAGER", "3333").await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = refund_request(CASHIER, 12_000, ORDER_ID);
    let verified = approval_service::verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");

    require_void_approval(&mut conn, &req, Some(&verified.token))
        .await
        .expect("token tüketilir");

    let err = require_void_approval(&mut conn, &req, Some(&verified.token))
        .await
        .expect_err("token tekrar kullanılamaz");
    assert_eq!(err, error::TOKEN_USED);
}

// ============================================================================
// 2. REFUNDS TABLOSU (doğrudan insert + sorgulama)
// ============================================================================

#[tokio::test]
async fn refunds_tablosu_reverse_kayit_ekler_ve_okur() {
    let pool = pool().await;
    seed_paid_order(&pool, ORDER_ID, 25_000).await;

    let refund_id = crate::id_generator::generate_id("ref");
    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, approval_token_hash, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, NULL, datetime('now'))",
    )
    .bind(&refund_id)
    .bind(TENANT)
    .bind(TXN_ID)
    .bind(ORDER_ID)
    .bind(&refund_id)
    .bind(25_000)
    .bind("Müşteri memnuniyetsizliği")
    .bind(MANAGER)
    .execute(&pool)
    .await
    .expect("refund kaydı yazılır");

    // Oku ve doğrula
    let row: (i64, String, String) =
        sqlx::query_as("SELECT amount_cents, original_order_id, reason FROM refunds WHERE id = ?")
            .bind(&refund_id)
            .fetch_one(&pool)
            .await
            .expect("satır okunur");

    assert_eq!(row.0, 25_000, "tutar kuruş olarak doğru");
    assert_eq!(row.1, ORDER_ID, "sipariş ID korunur");
    assert_eq!(row.2, "Müşteri memnuniyetsizliği");
}

#[tokio::test]
async fn refunds_sifir_tutar_red_rededilir() {
    let pool = pool().await;
    seed_paid_order(&pool, ORDER_ID, 25_000).await;

    let result = sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, datetime('now'))",
    )
    .bind("ref_zero")
    .bind(TENANT)
    .bind(TXN_ID)
    .bind(ORDER_ID)
    .bind("ref_zero")
    .bind(0i64) // CHECK amount_cents > 0
    .bind("test")
    .bind(MANAGER)
    .execute(&pool)
    .await;

    assert!(result.is_err(), "0 tutar CHECK kısıtlanmalı");
}

#[tokio::test]
async fn refunds_cross_tenant_okuma_engellenir() {
    let pool = pool().await;
    seed_paid_order(&pool, ORDER_ID, 10_000).await;

    let refund_id = crate::id_generator::generate_id("ref");
    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, datetime('now'))",
    )
    .bind(&refund_id)
    .bind(OTHER_TENANT)
    .bind(TXN_ID)
    .bind(ORDER_ID)
    .bind(&refund_id)
    .bind(10_000)
    .bind("cross-tenant test")
    .bind(MANAGER)
    .execute(&pool)
    .await
    .expect("başka tenant refund kaydı yazılabilir");

    // tenant_a sorgulaması boş döner
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refunds WHERE tenant_id = ?")
        .bind(TENANT)
        .fetch_one(&pool)
        .await
        .expect("sayma");

    assert_eq!(count, 0, "cross-tenant refund görünmemeli");
}

// ============================================================================
// 3. AUDIT LEDGER TERS KAYIDI (compensation:refund)
// ============================================================================

#[tokio::test]
async fn compensation_audit_ledger_fins_kategorisinde_yazilir() {
    use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

    let pool = pool().await;
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES ('usr_audit', 'tenant_a', 'OWNER', 'audit_user', 'hash', 1)")
        .execute(&pool)
        .await
        .expect("kullanıcı");

    let mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let ctx = AuditContext::new(
        TENANT.to_string(),
        "usr_audit".to_string(),
        "OWNER".to_string(),
        category::FINANS,
        "compensation:refund",
        "ref_comp_01".to_string(),
        serde_json::json!({
            "orderId": "ord_cvp_01",
            "amountCents": 25_000,
            "compensationTxnId": "ref_comp_01",
        }),
        "2026-10-09T12:00:00+00:00".to_string(),
    )
    .expect("geçerli kategori");

    AuditService::append(&mut conn, &audit_lock, &ctx)
        .await
        .expect("audit kaydı yazılır");

    let row: String =
        sqlx::query_scalar("SELECT action FROM audit_ledger WHERE resource_id = 'ref_comp_01'")
            .fetch_one(&mut *conn)
            .await
            .expect("satır okunur");
    assert_eq!(row, "compensation:refund");

    let cat: String =
        sqlx::query_scalar("SELECT category FROM audit_ledger WHERE resource_id = 'ref_comp_01'")
            .fetch_one(&mut *conn)
            .await
            .expect("kategori okunur");
    assert_eq!(cat, "FINANS");
}

// ============================================================================
// 4. CONFLICT_LOG TABLOSU
// ============================================================================

#[tokio::test]
async fn conflict_log_satir_ekler_ve_oku_r() {
    let pool = pool().await;

    let conflict_id = crate::id_generator::generate_id("cl");
    sqlx::query(
        "INSERT INTO conflict_log (id, tenant_id, table_id, order_id, conflict_type, \
            terminal_a, terminal_b, payload, status, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))",
    )
    .bind(&conflict_id)
    .bind(TENANT)
    .bind("tbl_1")
    .bind("ord_1")
    .bind("LINE_ITEM_PRICE_MISMATCH")
    .bind("dev_a")
    .bind("dev_b")
    .bind(r#"{"priceA": 5000, "priceB": 5500}"#)
    .execute(&pool)
    .await
    .expect("conflict log yazılır");

    let row: (String, String, String) =
        sqlx::query_as("SELECT conflict_type, terminal_a, status FROM conflict_log WHERE id = ?")
            .bind(&conflict_id)
            .fetch_one(&pool)
            .await
            .expect("okunur");

    assert_eq!(row.0, "LINE_ITEM_PRICE_MISMATCH");
    assert_eq!(row.1, "dev_a");
    assert_eq!(row.2, "PENDING");
}

#[tokio::test]
async fn conflict_log_cross_tenant_engellenir() {
    let pool = pool().await;

    let conflict_id = crate::id_generator::generate_id("cl");
    sqlx::query(
        "INSERT INTO conflict_log (id, tenant_id, table_id, order_id, conflict_type, \
            terminal_a, terminal_b, payload, status, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))",
    )
    .bind(&conflict_id)
    .bind(OTHER_TENANT)
    .bind("tbl_1")
    .bind("ord_1")
    .bind("ORDER_STATUS_CONFLICT")
    .bind("dev_a")
    .bind("dev_b")
    .bind("{}")
    .execute(&pool)
    .await
    .expect("başka tenantın kaydı yazılabilir");

    // tenant_a sorgulaması boş.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conflict_log WHERE tenant_id = ?")
        .bind(TENANT)
        .fetch_one(&pool)
        .await
        .expect("sayma");
    assert_eq!(count, 0, "cross-tenant conflict_log görünmemeli");
}

#[tokio::test]
async fn conflict_log_status_guncellenebilir() {
    let pool = pool().await;

    let conflict_id = crate::id_generator::generate_id("cl");
    sqlx::query(
        "INSERT INTO conflict_log (id, tenant_id, table_id, order_id, conflict_type, \
            terminal_a, terminal_b, payload, status, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'))",
    )
    .bind(&conflict_id)
    .bind(TENANT)
    .bind("tbl_1")
    .bind("ord_1")
    .bind("LINE_ITEM_DUPLICATE")
    .bind("dev_a")
    .bind("dev_b")
    .bind("{}")
    .execute(&pool)
    .await
    .expect("log yazılır");

    // Çözümleme: merge
    sqlx::query(
        "UPDATE conflict_log SET status = 'RESOLVED_MERGE', resolution = 'Merge by manager', \
            resolved_at = datetime('now'), resolved_by = ? WHERE id = ?",
    )
    .bind(MANAGER)
    .bind(&conflict_id)
    .execute(&pool)
    .await
    .expect("çözümleme yazılır");

    let status: String = sqlx::query_scalar("SELECT status FROM conflict_log WHERE id = ?")
        .bind(&conflict_id)
        .fetch_one(&pool)
        .await
        .expect("okunur");
    assert_eq!(status, "RESOLVED_MERGE");

    let resolved_by: String =
        sqlx::query_scalar("SELECT resolved_by FROM conflict_log WHERE id = ?")
            .bind(&conflict_id)
            .fetch_one(&pool)
            .await
            .expect("okunur");
    assert_eq!(resolved_by, MANAGER);
}
