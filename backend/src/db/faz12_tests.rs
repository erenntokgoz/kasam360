//! Faz 12 migration regresyonları.
//!
//! Kapsam dışı bırakılırsa sessiz tenant birleşmesi geri gelir: `inventory_batches`
//! üzerindeki `DEFAULT 'DEFAULT_TENANT'`, `tenant_id` bind edilmeyen her parti
//! yazımını ortak havuza indiriyordu. Testler bu sütunun kaybolduğunu kanıtlar.

use crate::db::faz12::{migrate_inventory_batches_for_shelf_life, migrate_products_for_86d};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

async fn legacy_batch_pool() -> sqlx::Pool<sqlx::Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE inventory_batches (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            inventory_item_id TEXT,
            product_id TEXT,
            batch_code TEXT,
            received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            initial_quantity REAL NOT NULL,
            remaining_quantity REAL NOT NULL,
            unit_cost_cents INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_inv_batches_prod
             ON inventory_batches(product_id, received_at ASC);
         CREATE INDEX IF NOT EXISTS idx_inv_batches_item
             ON inventory_batches(inventory_item_id, received_at ASC);
         INSERT INTO inventory_batches
             (id, tenant_id, product_id, batch_code, initial_quantity,
              remaining_quantity, unit_cost_cents)
         VALUES
             ('bat_1', 'tenant-a', 'prd_1', 'A-001', 10.0, 4.0, 25000),
             ('bat_2', 'tenant-b', 'prd_1', 'B-001', 5.0, 5.0, 31000);",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

/// `tenant_id` kolonunda varsayılan değer taşıyan satır sayısı. 0 ise kolon
/// NOT NULL ve varsayıansız demektir.
async fn tenant_default_count(pool: &sqlx::Pool<sqlx::Sqlite>) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pragma_table_info('inventory_batches')
          WHERE name = 'tenant_id' AND dflt_value IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn inventory_batch_migration_removes_tenant_default_so_missing_tenant_fails() {
    let pool = legacy_batch_pool().await;

    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();

    // Varsayılan kalktı: kolon NOT NULL, DEFAULT yok.
    let varsayilan = tenant_default_count(&pool).await;
    assert_eq!(
        varsayilan, 0,
        "tenant_id hâlâ varsayılan taşıyor, sessiz havuz birleşmesi sürüyor"
    );

    // tenant_id bind edilmeden yazılan parti artık hata verir.
    let sonuc = sqlx::query(
        "INSERT INTO inventory_batches (id, initial_quantity, remaining_quantity, unit_cost_cents)
         VALUES ('bat_3', 1.0, 1.0, 100)",
    )
    .execute(&pool)
    .await;
    assert!(
        sonuc.is_err(),
        "tenant_id bind edilmeden parti yazılabiliyor; tenant izolasyonu bozuk"
    );
}

#[tokio::test]
async fn inventory_batch_migration_preserves_every_tenant_row_and_cost() {
    let pool = legacy_batch_pool().await;

    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();

    let rows = sqlx::query(
        "SELECT id, tenant_id, batch_code, initial_quantity, remaining_quantity, unit_cost_cents
           FROM inventory_batches ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2, "yeniden kurulum satır kaybetti");
    assert_eq!(
        rows[0].try_get::<String, _>("tenant_id").unwrap(),
        "tenant-a"
    );
    assert_eq!(
        rows[1].try_get::<String, _>("tenant_id").unwrap(),
        "tenant-b"
    );
    assert_eq!(rows[1].try_get::<String, _>("batch_code").unwrap(), "B-001");
    assert_eq!(
        rows[0].try_get::<f64, _>("remaining_quantity").unwrap(),
        4.0
    );
    assert_eq!(rows[1].try_get::<i64, _>("unit_cost_cents").unwrap(), 31000);
}

#[tokio::test]
async fn inventory_batch_migration_adds_shelf_life_columns_as_null_for_existing_batches() {
    let pool = legacy_batch_pool().await;

    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();

    let kolonlar = sqlx::query("SELECT name FROM pragma_table_info('inventory_batches')")
        .fetch_all(&pool)
        .await
        .unwrap();
    let adlar: Vec<String> = kolonlar
        .iter()
        .map(|row| row.try_get::<String, _>("name").unwrap())
        .collect();
    assert!(
        adlar.iter().any(|ad| ad == "expiry_date"),
        "expiry_date yok"
    );
    assert!(
        adlar.iter().any(|ad| ad == "received_by"),
        "received_by yok"
    );

    // Eski partilerde raf ömrü bilinmiyor: NULL kalır, 0'a dönmez.
    let dolu: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inventory_batches
          WHERE expiry_date IS NOT NULL OR received_by IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(dolu, 0, "raf ömrü bilinmiyor, uyduruldu");
}

#[tokio::test]
async fn inventory_batch_migration_is_idempotent_and_keeps_indexes() {
    let pool = legacy_batch_pool().await;

    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();
    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();
    migrate_inventory_batches_for_shelf_life(&pool)
        .await
        .unwrap();

    let satirlar: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inventory_batches")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(satirlar, 2, "ikinci çalıştırma veriyi çoğalttı");

    let indeksler = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master
          WHERE type = 'index' AND tbl_name = 'inventory_batches' AND sql IS NOT NULL",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        indeksler.iter().any(|ad| ad == "idx_inv_batches_prod"),
        "parti indeksi yeniden kurulumda kayboldu: {indeksler:?}"
    );
    assert!(
        indeksler.iter().any(|ad| ad == "idx_inv_batches_tenant"),
        "tenant indeksi eksik"
    );
}

#[tokio::test]
async fn products_86_migration_adds_columns_and_defaults_to_available() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE products (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT 1
         );
         INSERT INTO products (id, tenant_id, name) VALUES ('prd_1', 'tenant-a', 'Kahve');",
    )
    .execute(&pool)
    .await
    .unwrap();

    migrate_products_for_86d(&pool).await.unwrap();
    migrate_products_for_86d(&pool).await.unwrap();

    let is_86: i64 = sqlx::query_scalar("SELECT is_86 FROM products WHERE id = 'prd_1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(is_86, 0, "mevcut ürün 86'da sayılmamalı");

    let stoktan_kaldi: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('products') WHERE name = 'stockout_reason'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stoktan_kaldi, 1, "stokout_reason kolonu eklenmedi");
}

#[tokio::test]
async fn inventory_batch_migration_refuses_malformed_table_instead_of_dropping_data() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE inventory_batches (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL
         );",
    )
    .execute(&pool)
    .await
    .unwrap();

    let sonuc = migrate_inventory_batches_for_shelf_life(&pool).await;

    assert!(
        sonuc.is_err(),
        "eksik kolonlu tablo sessizce yeniden kuruldu, veri kaybolurdu"
    );
}
