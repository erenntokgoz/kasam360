//! Fiyat bütünlüğü testleri için ortak yardımcı yordamlar.

use crate::commands::CartItemDto;
use crate::services::modifier_service;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

pub const SCHEMA: &str = include_str!("../../../migrations/schema.sql");
pub const TENANT: &str = "tenant_a";

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
    // Fiyat migration'ının test karşılığı.
    sqlx::raw_sql("ALTER TABLE modifier_groups ADD COLUMN category_id TEXT;")
        .execute(&pool)
        .await
        .ok();
    sqlx::raw_sql("ALTER TABLE order_items ADD COLUMN modifiers TEXT;")
        .execute(&pool)
        .await
        .ok();
    pool
}

pub async fn seed_catalog(pool: &sqlx::SqlitePool, product_price_cents: i64) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, 'Test Tenant')")
        .bind(TENANT)
        .execute(pool)
        .await
        .expect("tenant eklenir");
    sqlx::query(
        "INSERT OR IGNORE INTO categories (id, tenant_id, name) VALUES ('cat_1', ?, 'Test')",
    )
    .bind(TENANT)
    .execute(pool)
    .await
    .expect("kategori eklenir");
    sqlx::query(
        "INSERT OR IGNORE INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES ('prd_1', ?, 'Burger', ?, 2000, 'cat_1', 1)",
    )
    .bind(TENANT)
    .bind(product_price_cents)
    .execute(pool)
    .await
    .expect("ürün eklenir");
    // `orders.table_id` FK'si için şart.
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name, status) VALUES ('tbl_1', ?, 'Masa 1', 'AVAILABLE')")
        .bind(TENANT)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

pub async fn seed_option(pool: &sqlx::SqlitePool, name: &str, price_cents: i64) -> String {
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let group_id =
        modifier_service::create_group(&mut conn, TENANT, "Ekstralar", false, 0, None, None)
            .await
            .expect("grup oluşturulur");
    modifier_service::add_option(&mut conn, TENANT, &group_id, name, price_cents)
        .await
        .expect("seçenek eklenir")
}

pub fn item(id: &str, modifiers: Option<serde_json::Value>) -> CartItemDto {
    CartItemDto {
        id: id.to_string(),
        product: serde_json::json!({ "id": "prd_1" }),
        quantity: 1,
        unit_price: 0,
        tax_rate: Some(2000),
        subtotal: None,
        tax_amount: None,
        total: None,
        modifiers,
        note: None,
        discount: None,
        ..Default::default()
    }
}
