//! `report_service` test ortak yardımcıları ve veritabanı tohumları.

use super::super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub const TENANT_A: &str = "tenant_a";
pub const TENANT_B: &str = "tenant_b";

/// Denetim defteri `previous_hash` alanı için geçerli bir onaltılık dizi.
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
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

pub async fn conn_of(pool: &sqlx::SqlitePool) -> sqlx::pool::PoolConnection<sqlx::Sqlite> {
    pool.acquire().await.expect("bağlantı alınır")
}

pub async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
}

pub async fn seed_table(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name) VALUES (?, ?, ?)")
        .bind(id)
        .bind(tenant)
        .bind(id)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

pub async fn seed_category(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, 0)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .execute(pool)
    .await
    .expect("kategori eklenir");
}

pub async fn seed_product(pool: &sqlx::SqlitePool, tenant: &str, id: &str, category_id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES (?, ?, ?, 10000, 2000, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(category_id)
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

/// `orders` tablosunun CHECK kısıtı yalnız bu durumları kabul eder.
pub async fn seed_order(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    table_id: &str,
    total_cents: i64,
    created_at: &str,
    status: &str,
) {
    seed_table(pool, tenant, table_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO orders (id, tenant_id, table_id, status, total_cents, created_at, updated_at, cashier_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(table_id)
    .bind(status)
    .bind(total_cents)
    .bind(created_at)
    .bind(created_at)
    .bind(format!("usr_{}", tenant))
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

pub async fn seed_order_item(
    pool: &sqlx::SqlitePool,
    item_id: &str,
    order_id: &str,
    product_id: &str,
    quantity: i64,
    total_cents: i64,
) {
    sqlx::query(
        "INSERT OR REPLACE INTO order_items \
         (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) \
         VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, 'Sent')",
    )
    .bind(item_id)
    .bind(order_id)
    .bind(product_id)
    .bind(quantity)
    .bind(total_cents)
    .bind(total_cents)
    .execute(pool)
    .await
    .expect("kalem eklenir");
}

/// Denetim defteri satırı elle yazılır: testler hash zincirini değil, raporun
/// okuma kararını denetler. Zincir trigger'ı `previous_hash` değerinin bir
/// önceki kaydın `current_hash` ile birebir aynı olmasını zorunlu tutar.
pub async fn seed_audit(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    seq: i64,
    action: &str,
    resource_id: &str,
    actor_id: &str,
    payload: &serde_json::Value,
    timestamp: &str,
) {
    let previous_hash: String =
        sqlx::query_scalar("SELECT current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 1")
            .fetch_optional(pool)
            .await
            .expect("defter ucu okunur")
            .unwrap_or_else(|| HASH_ZEROS.to_string());

    sqlx::query(
        "INSERT INTO audit_ledger \
         (id, tenant_id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload, previous_hash, current_hash, hash_version) \
         VALUES (?, ?, ?, ?, ?, 'OWNER', 'SISTEM', ?, ?, ?, ?, ?, 1)",
    )
    .bind(format!("aud_{}_{}", tenant, seq))
    .bind(tenant)
    .bind(seq)
    .bind(timestamp)
    .bind(actor_id)
    .bind(action)
    .bind(resource_id)
    .bind(payload.to_string())
    .bind(previous_hash)
    // Denetim defteri trigger'ları hash'in 64 karakterlik SHA-256 onaltılık
    // olduğunu doğrular; test kaydı da bu kurala uyar.
    .bind(format!("{:064x}", seq))
    .execute(pool)
    .await
    .expect("denetim kaydı eklenir");
}

pub fn range(from: &str, to: &str) -> ReportRange {
    ReportRange::new(from, to)
}

pub const ARALIK: (&str, &str) = ("2026-01-01T00:00:00+00:00", "2026-12-31T23:59:59+00:00");
