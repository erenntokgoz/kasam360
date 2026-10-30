//! Mutfakta düşüm, iptalde iade, zayide fire ve eski adisyonun kapanışı.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const TENANT: &str = "tnt_a";
const NOW: &str = "2026-10-30T10:00:00+00:00";

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
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Tost', 10000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                        remaining_quantity, unit_cost_cents, received_at)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 2, 2, 100, '2026-01-01'),
                   ('bat_2', 'tnt_a', 'prd_1', 10, 10, 300, '2026-02-01');
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', 'tnt_a', 'Masa 1');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 30000);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents,
                                  stock_source_id)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 3, 30000, 'itm_1');",
    )
    .execute(&pool)
    .await
    .expect("adisyon");
    pool
}

async fn deducted() -> SqlitePool {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    deduct_line(&mut conn, TENANT, "itm_1", "prd_1", 3, NOW)
        .await
        .expect("düşüm");
    drop(conn);
    pool
}

async fn stock(pool: &SqlitePool, batch: &str) -> f64 {
    sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = ?")
        .bind(batch)
        .fetch_one(pool)
        .await
        .expect("stok")
}

async fn release(pool: &SqlitePool, reason: &str) -> Option<i64> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    release_line(&mut conn, TENANT, "itm_1", reason, "usr_1", NOW)
        .await
        .expect("iptal")
}

#[tokio::test]
async fn iptal_stogu_alindigi_partilere_geri_koyar() {
    let pool = deducted().await;
    assert_eq!(stock(&pool, "bat_1").await, 0.0);
    assert_eq!(stock(&pool, "bat_2").await, 9.0);

    assert_eq!(release(&pool, "Müşteri Vazgeçti").await, None);

    assert_eq!(stock(&pool, "bat_1").await, 2.0);
    assert_eq!(stock(&pool, "bat_2").await, 10.0);
}

#[tokio::test]
async fn mutfak_zayi_stogu_geri_koymaz_maliyetle_fire_yazar() {
    let pool = deducted().await;
    assert_eq!(release(&pool, "Mutfak Zayi").await, Some(500));

    assert_eq!(stock(&pool, "bat_1").await, 0.0);
    assert_eq!(stock(&pool, "bat_2").await, 9.0);
    let (reason, cost): (String, i64) =
        sqlx::query_as("SELECT reason, total_cost_cents FROM waste_records")
            .fetch_one(&pool)
            .await
            .expect("fire");
    assert_eq!((reason.as_str(), cost), ("FIRE_EDILDI", 500));
}

#[tokio::test]
async fn hazirligi_baslamis_kalem_gerekceden_bagimsiz_fire_olur() {
    let pool = deducted().await;
    sqlx::query("UPDATE order_items SET status = 'Preparing' WHERE id = 'itm_1'")
        .execute(&pool)
        .await
        .expect("hazırlık");

    assert_eq!(release(&pool, "Müşteri Vazgeçti").await, Some(500));
    assert_eq!(stock(&pool, "bat_2").await, 9.0);
}

#[tokio::test]
async fn bolunen_kalem_yalniz_kendi_payini_iade_eder() {
    let pool = deducted().await;
    sqlx::raw_sql(
        "UPDATE order_items SET quantity = 2 WHERE id = 'itm_1';
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, stock_source_id)
            VALUES ('itm_2', 'tnt_a', 'ord_1', 'prd_1', 1, 'itm_1');",
    )
    .execute(&pool)
    .await
    .expect("bölme");

    release(&pool, "Hatalı Giriş").await;

    let total = stock(&pool, "bat_1").await + stock(&pool, "bat_2").await;
    assert!((total - 11.0).abs() < 1e-9, "{total}");
}

#[tokio::test]
async fn kapanis_duseni_tekrar_dusmez_eski_kalemi_bir_kez_duser() {
    let pool = deducted().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let done = settle_order_lines(&mut conn, TENANT, "ord_1", NOW)
        .await
        .expect("kapanış");
    assert_eq!(done.total_cogs_cents, 500);
    drop(conn);
    assert_eq!(stock(&pool, "bat_2").await, 9.0, "ikinci düşüm yok");

    sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity)
         VALUES ('itm_eski', 'tnt_a', 'ord_1', 'prd_1', 1)",
    )
    .execute(&pool)
    .await
    .expect("eski kalem");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let done = settle_order_lines(&mut conn, TENANT, "ord_1", NOW)
        .await
        .expect("kapanış");
    assert_eq!(done.total_cogs_cents, 800);
    drop(conn);
    assert_eq!(stock(&pool, "bat_2").await, 8.0, "eski kalem bir kez düşer");
}
