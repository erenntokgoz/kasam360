//! `modifier_service` test ortak yardımcıları ve veritabanı tohumları.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");

pub const TENANT_A: &str = "tenant_a";
pub const TENANT_B: &str = "tenant_b";

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

/// `schema.sql` idempotent CREATE kullanır; bu ALTER'lar `db.rs`'in çalışma
/// zamanı migration'larının test karşılığıdır. Testsiz bırakılırsa kolon yok
/// sayılır ve test sessizce yanlış anlam çıkarır.
pub async fn apply_runtime_migrations(pool: &sqlx::SqlitePool) {
    sqlx::raw_sql("ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;")
        .execute(pool)
        .await
        .ok();
    sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_category \
         ON modifier_groups(tenant_id, category_id);",
    )
    .execute(pool)
    .await
    .ok();
}

pub async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
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

pub async fn seed_product(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    category_id: &str,
    price_cents: i64,
) {
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES (?, ?, ?, ?, 2000, ?, 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .bind(price_cents)
    .bind(category_id)
    .execute(pool)
    .await
    .expect("ürün eklenir");
}

/// `PoolConnection` `DerefMut<Target = SqliteConnection>` uygular; `&mut conn`
/// çağrılarda otomatik olarak `&mut SqliteConnection`'a dönüşür.
pub async fn conn_of(pool: &sqlx::SqlitePool) -> sqlx::pool::PoolConnection<sqlx::Sqlite> {
    pool.acquire().await.expect("bağlantı alınır")
}

pub fn options_json(ids: &[&str]) -> serde_json::Value {
    serde_json::json!(ids
        .iter()
        .map(|id| serde_json::json!({ "id": id, "name": "Seçenek", "priceCents": 0 }))
        .collect::<Vec<_>>())
}
