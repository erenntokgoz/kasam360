//! Kapanan masalar, gün sonu arşivi ve para hesapları testlerinin ortak tohumları.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const TENANT_A: &str = "tnt_a";
pub const TENANT_B: &str = "tnt_b";
pub const HASH_ZEROS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

pub async fn seed_user(pool: &sqlx::SqlitePool, tenant: &str, id: &str, name: &str) {
    sqlx::query("INSERT INTO users (id, tenant_id, role, name) VALUES (?, ?, 'CASHIER', ?)")
        .bind(id)
        .bind(tenant)
        .bind(name)
        .execute(pool)
        .await
        .expect("kullanıcı eklenir");
}

pub async fn seed_table(pool: &sqlx::SqlitePool, tenant: &str, id: &str, name: &str) {
    sqlx::query("INSERT INTO tables (id, tenant_id, name) VALUES (?, ?, ?)")
        .bind(id)
        .bind(tenant)
        .bind(name)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

pub async fn seed_order(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    table_id: &str,
    status: &str,
    total_cents: i64,
    opener: &str,
) {
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, cashier_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, '2026-03-01 10:00:00', '2026-03-01 10:00:00')",
    )
    .bind(id)
    .bind(tenant)
    .bind(table_id)
    .bind(status)
    .bind(total_cents)
    .bind(opener)
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

/// Zincire uygun denetim satırı: sıra numarası ve önceki hash veritabanından okunur.
pub async fn seed_ledger(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    action: &str,
    resource_id: &str,
    actor: &str,
    payload: &serde_json::Value,
    timestamp: &str,
) {
    let (sequence, previous): (i64, String) = sqlx::query_as(
        "SELECT COALESCE(MAX(sequence), 0) + 1, \
                COALESCE((SELECT current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1), ?) \
         FROM audit_ledger",
    )
    .bind(HASH_ZEROS)
    .fetch_one(pool)
    .await
    .expect("defter ucu okunur");
    sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, \
         action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES (?, ?, ?, ?, ?, 'OWNER', 'ODEME', ?, ?, ?, ?, ?, 1)",
    )
    .bind(format!("aud_{sequence}"))
    .bind(tenant)
    .bind(sequence)
    .bind(timestamp)
    .bind(actor)
    .bind(action)
    .bind(resource_id)
    .bind(payload.to_string())
    .bind(previous)
    .bind(format!("{sequence:064x}"))
    .execute(pool)
    .await
    .expect("denetim kaydı eklenir");
}

/// Tek tahsilat kaydı: tutarlar kanal kırılımıyla birlikte yazılır.
#[allow(clippy::too_many_arguments)]
pub async fn seed_payment(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    order_id: &str,
    txn: &str,
    actor: &str,
    cash: i64,
    card: i64,
    timestamp: &str,
) {
    seed_ledger(
        pool,
        tenant,
        "payment:settled_fifo",
        txn,
        actor,
        &serde_json::json!({
            "transactionId": txn,
            "orderId": order_id,
            "method": if card > 0 { "CARD" } else { "CASH" },
            "totalAmount": cash + card,
            "cashAmountCents": cash,
            "cardAmountCents": card,
            "mealCardAmountCents": 0,
            "veresiyeAmountCents": 0,
        }),
        timestamp,
    )
    .await;
}
