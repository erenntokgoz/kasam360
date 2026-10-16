//! `receipt_service` testleri için ortak yardımcı yordamlar.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub const TENANT_A: &str = "tenant_a";
pub const TENANT_B: &str = "tenant_b";

pub const FROM: &str = "2026-01-01 00:00:00";
pub const TO: &str = "2026-12-31 23:59:59";

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
        .bind("Masa 1")
        .execute(pool)
        .await
        .expect("masa eklenir");
}

pub async fn seed_order(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    table_id: &str,
    total_cents: i64,
    status: &str,
) {
    seed_table(pool, tenant, table_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO orders \
         (id, tenant_id, table_id, status, total_cents, created_at, updated_at, cashier_id) \
         VALUES (?, ?, ?, ?, ?, '2026-05-01 12:00:00', '2026-05-01 12:00:00', NULL)",
    )
    .bind(id)
    .bind(tenant)
    .bind(table_id)
    .bind(status)
    .bind(total_cents)
    .execute(pool)
    .await
    .expect("sipariş eklenir");
}

pub async fn seed_product(pool: &sqlx::SqlitePool, tenant: &str, id: &str) {
    // `products.category_id` yabancı anahtarı NOT NULL: kategori önce eklenir.
    sqlx::query(
        "INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, 0)",
    )
    .bind(format!("cat_{}", tenant))
    .bind(tenant)
    .bind("Kategori")
    .execute(pool)
    .await
    .expect("ategori eklenir");
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES (?, ?, ?, 1000, 2000, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(format!("cat_{}", tenant))
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

pub async fn seed_order_item(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    item_id: &str,
    order_id: &str,
    product_id: &str,
    quantity: i64,
    subtotal_cents: i64,
    tax_cents: i64,
) {
    seed_product(pool, tenant, product_id).await;
    sqlx::query(
        "INSERT OR REPLACE INTO order_items \
         (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) \
         VALUES (?, ?, ?, ?, 1000, 2000, ?, ?, ?, 'Sent')",
    )
    .bind(item_id)
    .bind(order_id)
    .bind(product_id)
    .bind(quantity)
    .bind(subtotal_cents)
    .bind(tax_cents)
    .bind(subtotal_cents + tax_cents)
    .execute(pool)
    .await
    .expect("kalem eklenir");
}

pub async fn seed_sale_event(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    transaction_id: &str,
    payload: serde_json::Value,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
         VALUES (?, ?, ?, 'SALE', 'SALE_SETTLED', ?, ?)",
    )
    .bind(format!("evt_{}", transaction_id))
    .bind(tenant)
    .bind(transaction_id)
    .bind(payload.to_string())
    .bind(created_at)
    .execute(pool)
    .await
    .expect("tahsilat kaydı eklenir");
}

pub fn payment_payload(
    order_id: Option<&str>,
    total_cents: i64,
    method: &str,
) -> serde_json::Value {
    serde_json::json!({
        "transactionId": "txn_test",
        "orderId": order_id,
        "method": method,
        "totalAmount": total_cents,
        "amountTendered": total_cents,
        "changeAmount": 0,
        "timestamp": "2026-05-01T12:00:00+00:00",
        "items": []
    })
}
