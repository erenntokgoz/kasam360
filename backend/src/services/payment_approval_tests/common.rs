//! `payment_approval` testleri için ortak yardımcı yordamlar.

use super::*;
use crate::approval_service::ApprovalRequest;
use crate::repositories::payment_repository::ServerTruth;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub const TENANT: &str = "tenant_a";
pub const CASHIER: &str = "usr_cashier";
pub const TRANSACTION: &str = "txn_01";

pub async fn pool() -> sqlx::SqlitePool {
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

pub async fn seed_user(pool: &sqlx::SqlitePool, id: &str, role: &str, pin: &str) {
    seed_user_in(pool, id, TENANT, role, pin).await;
}

pub async fn seed_user_in(pool: &sqlx::SqlitePool, id: &str, tenant: &str, role: &str, pin: &str) {
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

pub fn truth(subtotal: i64, tax: i64, discount: i64, gross: i64) -> ServerTruth {
    ServerTruth {
        subtotal_cents: subtotal,
        tax_cents: tax,
        discount_cents: discount,
        gross_cents: gross,
        total_cents: (subtotal + tax - discount).max(0),
    }
}

pub fn discount_truth(discount: i64) -> ServerTruth {
    truth(10_000, 1_000, discount, 11_000)
}

pub async fn lock_for<'a>(mutex: &'a tokio::sync::Mutex<()>) -> AuditLock<'a> {
    AuditLock::new(mutex.lock().await)
}

pub async fn consume<'a>(
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

pub async fn consume_without_audit(
    conn: &mut sqlx::SqliteConnection,
    server_truth: &ServerTruth,
    token: Option<&str>,
) -> Result<Option<ConsumedApproval>, String> {
    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = lock_for(&audit_mutex).await;
    consume(conn, &audit_lock, server_truth, token).await
}

pub fn issue_base() -> ApprovalRequest {
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

pub async fn consume_for(
    conn: &mut sqlx::SqliteConnection,
    resource_id: &str,
    server_truth: &ServerTruth,
    token: Option<&str>,
    issue_for: &ApprovalRequest,
) -> Result<Option<ConsumedApproval>, String> {
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
