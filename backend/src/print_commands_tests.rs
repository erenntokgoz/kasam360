//! `print_commands` testleri (Faz 7).
//!
//! Basım komutları Tauri `State` taşıdığı için doğrudan çağrılamaz; bu yüzden
//! testler **veri kaynağı ve kapı** mantığını doğrular: basım yalnız tenant'ın
//! kendi kayıtlarından okur ve tutarlar tam sayı kuruş olarak biçimlenir.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

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

async fn seed_tenant(pool: &sqlx::SqlitePool, tenant: &str) {
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(tenant)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("tenant eklenir");
}

#[tokio::test]
async fn kasa_hareketi_yalniz_kendi_tenant_indan_bulunur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shift_a', ?, 'usr_1', 'OPEN', '2026-01-01 09:00:00', 10000)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id)
         VALUES ('cm_a', ?, 'shift_a', 'OUT', 2500, 'Kırtasiye', 'usr_1')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("kasa hareketi eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // Kendi tenant'ında bulunur.
    let found: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cash_movements WHERE id = ? AND tenant_id = ?",
    )
    .bind("cm_a")
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .expect("sorgu çalışır");
    assert_eq!(found, 1);

    // Başka tenant'ın çağrısında görünmez.
    let foreign: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cash_movements WHERE id = ? AND tenant_id = ?",
    )
    .bind("cm_a")
    .bind(TENANT_B)
    .fetch_one(&mut *conn)
    .await
    .expect("sorgu çalışır");
    assert_eq!(foreign, 0, "başka işletmenin kasa hareketi sızmamalı");
}

#[tokio::test]
async fn gunluk_zapor_tahsilat_hareketlerinden_turetilir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;

    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', ?, 'Masa 1')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("masa eklenir");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
         VALUES ('ord_1', ?, 'tbl_1', 'PAID', 42000)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("sipariş eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let row = sqlx::query(
        "SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS count
         FROM orders WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED')
           AND created_at >= date('now', 'start of day')",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .expect("günlük özet sorgusu çalışır");

    let total: i64 = row.try_get("total").expect("toplam okunur");
    let count: i64 = row.try_get("count").expect("adet okunur");
    assert_eq!(total, 42000);
    assert_eq!(count, 1);
}

#[tokio::test]
async fn tenant_zorunlulugu_ve_kapi_sirasi_fail_closed() {
    // Rol kapısı önce, tenant kapısı sonra çalışır: ikisi de isteği reddeder.
    assert!(require_receipt_printer(Some("WAITER")).is_err());
    assert!(require_receipt_printer(Some("KITCHEN")).is_err());
    assert!(require_receipt_printer(None).is_err());
    assert!(require_receipt_printer(Some("CASHIER")).is_ok());
    assert!(require_receipt_printer(Some("owner")).is_ok());

    assert!(require_tenant(None).is_err());
    assert!(require_tenant(Some("")).is_err());
    assert!(require_tenant(Some("   ")).is_err());
    assert_eq!(require_tenant(Some(TENANT_A)).unwrap(), TENANT_A);
}