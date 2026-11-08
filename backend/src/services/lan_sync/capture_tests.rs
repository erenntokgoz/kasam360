//! Tetikleyici kapısı ve satır değişikliğinin yeniden uygulanması.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    pool
}

const WRITE: &str = "INSERT INTO products (id, tenant_id, category_id, name, price_cents)
                     VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000)";

#[tokio::test]
async fn butun_tablolara_tetikleyici_kurulur_ve_kaldirilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    sync_triggers(&mut conn, TriggerMode::Cluster)
        .await
        .expect("kurulum");
    let count =
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_cap_%'";
    let installed: i64 = sqlx::query_scalar(count)
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert!(installed > 100, "{installed}");

    sync_triggers(&mut conn, TriggerMode::Off)
        .await
        .expect("kaldırma");
    let left: i64 = sqlx::query_scalar(count)
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(left, 0);
}

#[tokio::test]
async fn kapidan_gecmeyen_yazma_durur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    sync_triggers(&mut conn, TriggerMode::Cluster)
        .await
        .expect("kurulum");
    let error = sqlx::query(WRITE)
        .execute(&mut *conn)
        .await
        .expect_err("kapı")
        .to_string();
    assert!(error.contains("SYNC_UNSUPPORTED"), "{error}");
}

#[tokio::test]
async fn yakalanan_degisiklik_ikinci_veritabaninda_ayni_sonucu_verir() {
    let source = pool().await;
    let target = pool().await;
    let mut conn = source.acquire().await.expect("bağlantı");
    sync_triggers(&mut conn, TriggerMode::Cluster)
        .await
        .expect("kurulum");
    sqlx::raw_sql(
        "BEGIN;
         INSERT INTO sync_write_gate (mode) VALUES ('CAPTURE');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents, tax_rate_bp)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'O''Çay', 1000, 1000);
         UPDATE products SET price_cents = 1250 WHERE id = 'prd_1';
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_2', 'tnt_a', 'cat_1', 'Silinecek', 1);
         DELETE FROM products WHERE id = 'prd_2';",
    )
    .execute(&mut *conn)
    .await
    .expect("yazma");
    let changes = read_capture(&mut conn).await.expect("okuma");
    sqlx::query("ROLLBACK")
        .execute(&mut *conn)
        .await
        .expect("geri al");
    assert_eq!(changes.len(), 4);
    let products: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(products, 0, "kaynak onaydan önce yazmaz");

    let mut other = target.acquire().await.expect("bağlantı");
    apply_changes(&mut other, &changes, false)
        .await
        .expect("uygulama");
    let rows: Vec<(String, i64, i64)> =
        sqlx::query_as("SELECT name, price_cents, tax_rate_bp FROM products")
            .fetch_all(&mut *other)
            .await
            .expect("satır");
    assert_eq!(rows, vec![("O'Çay".to_string(), 1250, 1000)]);
}

#[tokio::test]
async fn esitleme_durumu_agdan_gelen_satirla_degistirilemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let change = RowChange {
        table: "sync_cluster".to_string(),
        action: "D".to_string(),
        key: Some(
            serde_json::json!({ "slot": 1 })
                .as_object()
                .expect("nesne")
                .clone(),
        ),
        row: None,
        old: None,
    };
    assert!(apply_changes(&mut conn, &[change], false).await.is_err());
}

#[tokio::test]
async fn cihaza_ozel_tablo_yalniz_kaynak_cihazda_yazilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let row = serde_json::json!({
        "id": "obx_1", "tenant_id": "tnt_a", "event_id": "evt_1", "status": "PENDING",
    });
    let change = RowChange {
        table: "outbox".to_string(),
        action: "I".to_string(),
        key: None,
        row: Some(row.as_object().expect("nesne").clone()),
        old: None,
    };
    apply_changes(&mut conn, std::slice::from_ref(&change), false)
        .await
        .expect("başka cihaz");
    let count = "SELECT COUNT(*) FROM outbox";
    let other: i64 = sqlx::query_scalar(count)
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(other, 0);

    apply_changes(&mut conn, &[change], true)
        .await
        .expect("kaynak");
    let origin: i64 = sqlx::query_scalar(count)
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(origin, 1);
}
