//! Maliyeti eksik satış sayımı testleri.
//!
//! Partisi olmayan tüketim kârı şişirir; rapor bunu sayıyla söylemelidir.
//! Ayrı dosya: ana P&L test dosyası başka değişikliklerle paylaşılıyor.

use crate::services::pnl_service::financial_report;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");
const TENANT: &str = "tenant_a";

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

/// İki ayrı ayda üç kalem: biri partili, biri eksik, biri eksik ama iptal.
async fn seed(pool: &sqlx::SqlitePool) {
    sqlx::raw_sql(
        "PRAGMA foreign_keys = OFF;
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at) VALUES
            ('ord_1', 'tenant_a', 'tbl_1', 'PAID', 30000, '2026-10-05 20:00:00'),
            ('ord_2', 'tenant_a', 'tbl_1', 'PAID', 10000, '2026-09-05 20:00:00'),
            ('ord_3', 'tenant_b', 'tbl_1', 'PAID', 10000, '2026-10-05 20:00:00');
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, status, stock_source_id) VALUES
            ('itm_1', 'tenant_a', 'ord_1', 'prd_1', 1, 10000, 'SERVED', 'itm_1'),
            ('itm_2', 'tenant_a', 'ord_1', 'prd_1', 1, 10000, 'SERVED', 'itm_2'),
            ('itm_3', 'tenant_a', 'ord_1', 'prd_1', 1, 10000, 'CANCELLED', 'itm_3'),
            ('itm_4', 'tenant_a', 'ord_2', 'prd_1', 1, 10000, 'SERVED', 'itm_4'),
            ('itm_5', 'tenant_b', 'ord_3', 'prd_1', 1, 10000, 'SERVED', 'itm_5');
         INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload) VALUES
            ('evt_1', 'tenant_a', 'itm_1', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', '{\"untrackedDeficit\": 0.0}'),
            ('evt_2', 'tenant_a', 'itm_2', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', '{\"untrackedDeficit\": 0.5}'),
            ('evt_3', 'tenant_a', 'itm_3', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', '{\"untrackedDeficit\": 1.0}'),
            ('evt_4', 'tenant_a', 'itm_4', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', '{\"untrackedDeficit\": 2.0}'),
            ('evt_5', 'tenant_b', 'itm_5', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', '{\"untrackedDeficit\": 1.0}');
         PRAGMA foreign_keys = ON;",
    )
    .execute(pool)
    .await
    .expect("satışlar eklenir");
}

#[tokio::test]
async fn partisiz_satis_donem_icinde_sayilir() {
    let p = pool().await;
    seed(&p).await;
    let october = Some(("2026-10-01".to_string(), "2026-10-31".to_string()));

    let r = financial_report(&p, TENANT, &october)
        .await
        .expect("rapor okunur");

    // Partili kalem, iptal kalem, başka ay ve başka kiracı sayılmaz.
    assert_eq!(r.cost_missing_lines, 1);
}

#[tokio::test]
async fn tum_zamanda_her_eksik_kalem_sayilir() {
    let p = pool().await;
    seed(&p).await;

    let r = financial_report(&p, TENANT, &None)
        .await
        .expect("rapor okunur");

    assert_eq!(r.cost_missing_lines, 2);
}

#[tokio::test]
async fn eksik_yoksa_sayi_sifirdir() {
    let p = pool().await;

    let r = financial_report(&p, TENANT, &None)
        .await
        .expect("rapor okunur");

    assert_eq!(r.cost_missing_lines, 0);
}
