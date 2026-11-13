//! Stok hareket raporu: gerçek FIFO maliyeti, açılış/kapanış çözümü, fire/sayım/iade ve
//! kiracı yalıtımı.

use super::*;
use crate::services::order_stock;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const TENANT: &str = "tnt_a";
const OTHER: &str = "tnt_b";
const FROM: &str = "2026-11-01T00:00:00+00:00";
const TO: &str = "2026-12-01T00:00:00+00:00";
const NOW: &str = "2026-11-10T12:00:00+00:00";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    crate::services::stock_trail::ensure_columns(&pool)
        .await
        .expect("kolon");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel'), ('cat_2', 'tnt_b', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents, stock_unit) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Süt', 100, 'adet'),
            ('prd_x', 'tnt_b', 'cat_2', 'Başka Süt', 100, 'adet');
         INSERT INTO inventory_batches (id, tenant_id, product_id, received_at, initial_quantity, remaining_quantity, unit_cost_cents) VALUES
            ('bat_old', 'tnt_a', 'prd_1', '2026-10-20 08:00:00', 10, 10, 100),
            ('bat_new', 'tnt_a', 'prd_1', '2026-11-05 08:00:00', 10, 10, 200),
            ('bat_x', 'tnt_b', 'prd_x', '2026-11-05 08:00:00', 99, 99, 7);",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

/// Hareket zamanı gerçek saatten alınır; testin dönemine sabitlenir.
async fn pin_movement_times(pool: &SqlitePool) {
    sqlx::query("UPDATE stock_movements SET created_at = '2026-11-10 12:00:00'")
        .execute(pool)
        .await
        .expect("zaman sabitlenir");
}

async fn sell(pool: &SqlitePool, item: &str, quantity: i64) {
    let mut conn = pool.acquire().await.expect("bağlantı");
    order_stock::deduct_line(&mut conn, TENANT, item, "prd_1", quantity, NOW)
        .await
        .expect("düşüm");
}

#[tokio::test]
async fn satis_maliyeti_fifo_partilerinden_gelir_ve_acilis_kapanis_tutar() {
    let pool = pool().await;
    // 12 adet: eski partiden 10 x 100, yeni partiden 2 x 200.
    sell(&pool, "itm_1", 12).await;
    pin_movement_times(&pool).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = report(&mut conn, TENANT, FROM, TO, None)
        .await
        .expect("rapor");
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.sale_quantity, 12.0);
    assert_eq!(row.sale_cost_cents, 1_400);
    assert_eq!(row.intake_quantity, 10.0, "yalnız dönemdeki parti giriştir");
    assert_eq!(row.intake_cost_cents, 2_000);
    assert_eq!(row.opening_quantity, 10.0);
    assert_eq!(row.closing_quantity, 8.0);
    assert_eq!(
        row.opening_quantity + row.intake_quantity - row.sale_quantity,
        row.closing_quantity
    );
    assert_eq!(row.unknown_cost_quantity, 0.0);
    assert_eq!(row.closing_cost_cents, Some(1_600));
}

#[tokio::test]
async fn partisiz_satis_maliyeti_sifirla_gizlenmez() {
    let pool = pool().await;
    // Stoktaki 20 adedin üstünde 3 adet daha: parti yok, maliyet bilinmiyor.
    sell(&pool, "itm_1", 23).await;
    pin_movement_times(&pool).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = report(&mut conn, TENANT, FROM, TO, None)
        .await
        .expect("rapor");
    assert_eq!(rows[0].sale_cost_cents, 10 * 100 + 10 * 200);
    assert_eq!(rows[0].unknown_cost_quantity, 3.0);
}

#[tokio::test]
async fn fire_iptali_sayim_ve_iade_dogru_maliyetle_yazilir() {
    let pool = pool().await;
    sell(&pool, "itm_1", 3).await;
    sqlx::raw_sql(
        "INSERT INTO waste_records (id, tenant_id, product_id, reason, quantity, unit_cost_cents,
                                    total_cost_cents, occurred_at, recorded_by)
            VALUES ('wst_1', 'tnt_a', 'prd_1', 'BOZULDU', 2, 100, 200, '2026-11-10T12:00:00Z', 'usr_1');
         INSERT INTO stock_counts (id, tenant_id, status, started_by, started_at)
            VALUES ('cnt_1', 'tnt_a', 'UYGULANDI', 'usr_1', '2026-11-10T12:00:00Z');
         INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, product_id, counted_quantity,
                                        variance_quantity, variance_cost_cents)
            VALUES ('scl_1', 'tnt_a', 'cnt_1', 'prd_1', 0, -1, 100);
         INSERT INTO stock_movements (id, tenant_id, product_id, movement_type, quantity, actor_id, source_type, source_id) VALUES
            ('smv_w', 'tnt_a', 'prd_1', 'WASTE', 2, 'usr_1', 'WASTE_RECORD', 'wst_1'),
            ('smv_v', 'tnt_a', 'prd_1', 'IN', 1, 'usr_1', 'WASTE_VOID', 'wst_1'),
            ('smv_c', 'tnt_a', 'prd_1', 'ADJUST', -1, 'usr_1', 'STOCK_COUNT', 'cnt_1'),
            ('smv_r', 'tnt_a', 'prd_1', 'IN', 1, 'usr_1', 'ORDER_VOID', 'itm_1');",
    )
    .execute(&pool)
    .await
    .expect("hareketler");
    pin_movement_times(&pool).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = report(&mut conn, TENANT, FROM, TO, None)
        .await
        .expect("rapor");
    let row = &rows[0];
    assert_eq!(
        row.waste_quantity, 1.0,
        "iptal edilen miktar net fireden düşer"
    );
    assert_eq!(row.waste_cost_cents, 100);
    assert_eq!(row.count_quantity, -1.0);
    assert_eq!(row.count_cost_cents, -100);
    assert_eq!(row.return_quantity, 1.0);
    assert_eq!(row.return_cost_cents, 100, "satış olayının birim maliyeti");
    assert_eq!(row.sale_cost_cents, 300);
    assert_eq!(
        row.opening_quantity + row.intake_quantity - row.sale_quantity - row.waste_quantity
            + row.count_quantity
            + row.return_quantity,
        row.closing_quantity
    );
}

#[tokio::test]
async fn baska_kiracinin_stogu_ve_hareketi_rapora_girmez() {
    let pool = pool().await;
    sell(&pool, "itm_1", 1).await;
    pin_movement_times(&pool).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let own = report(&mut conn, TENANT, FROM, TO, None)
        .await
        .expect("rapor");
    assert!(own.iter().all(|row| row.product_id == "prd_1"));
    let other = report(&mut conn, OTHER, FROM, TO, None)
        .await
        .expect("rapor");
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].product_id, "prd_x");
    assert_eq!(other[0].intake_quantity, 99.0);
    assert_eq!(other[0].sale_quantity, 0.0);
    let crossed = report(&mut conn, OTHER, FROM, TO, Some("prd_1"))
        .await
        .expect("rapor");
    assert!(
        crossed.is_empty(),
        "başka kiracının ürünü süzgeçle de görünmez"
    );
}
