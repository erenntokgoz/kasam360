//! `products.category_id` boşaltma göçü regresyon testleri.
//!
//! Göç bozulursa ya hammadde hiç kaydedilemez (kolon kısıtlı kalır) ya da ürün
//! satırları ve kategori bağları kaybolur; testler ikisini de sınar.

use super::products_category_migration::migrate_products_nullable_category;
use sqlx::sqlite::SqlitePoolOptions;

async fn legacy_pool() -> sqlx::Pool<sqlx::Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE categories (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL);
         CREATE TABLE products (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category_id TEXT NOT NULL,
            is_raw INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (category_id) REFERENCES categories(id)
         );
         CREATE INDEX idx_products_tenant_raw ON products(tenant_id, is_raw);
         CREATE TABLE order_items (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
         );
         INSERT INTO categories VALUES ('cat_1', 'ten_a', 'İçecek');
         INSERT INTO products VALUES ('prd_1', 'ten_a', 'Çay', 'cat_1', 0);
         INSERT INTO order_items VALUES ('oit_1', 'prd_1');",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn kategori_kolonu_bosaltilir_ve_veri_korunur() {
    let pool = legacy_pool().await;
    migrate_products_nullable_category(&pool).await.unwrap();

    let not_null: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('products') WHERE name = 'category_id' AND \"notnull\" = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(not_null, 0);

    let category: Option<String> = sqlx::query_scalar(
        "SELECT category_id FROM products WHERE id = 'prd_1' AND tenant_id = 'ten_a'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(category.as_deref(), Some("cat_1"), "mevcut bağ korunur");

    let index: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_products_tenant_raw'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(index, 1, "indeks yeniden kurulur");

    sqlx::query("INSERT INTO products (id, tenant_id, name, category_id, is_raw) VALUES ('prd_2', 'ten_a', 'Un', NULL, 1)")
        .execute(&pool)
        .await
        .expect("hammadde kategorisiz kaydedilir");
    let broken: Vec<(String,)> = sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(broken.is_empty(), "yabancı anahtarlar bozulmaz");

    // İkinci çalıştırma tabloyu yeniden kurmaz.
    migrate_products_nullable_category(&pool).await.unwrap();
}
