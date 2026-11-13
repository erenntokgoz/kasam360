//! Teslim listesi: kiracı yalıtımı, yalnız hazır kalem, bir kez teslim ve bekleme süresi.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const NOW: &str = "2026-11-13 12:10:00";

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
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_a', 'tnt_a', 'G'), ('cat_b', 'tnt_b', 'G');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
            VALUES ('prd_a', 'tnt_a', 'cat_a', 'Tost', 10000), ('prd_b', 'tnt_b', 'cat_b', 'Çay', 500);
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_a', 'tnt_a', 'Masa 4'), ('tbl_b', 'tnt_b', 'Masa 9');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents, updated_at)
            VALUES ('ord_a', 'tnt_a', 'tbl_a', 'IN_PROGRESS', 20000, '2026-11-13 12:00:00'),
                   ('ord_b', 'tnt_b', 'tbl_b', 'IN_PROGRESS', 500, '2026-11-13 12:00:00'),
                   ('ord_paid', 'tnt_a', 'tbl_a', 'PAID', 10000, '2026-11-13 12:00:00');
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, status)
            VALUES ('itm_ready', 'tnt_a', 'ord_a', 'prd_a', 2, 20000, 'Ready'),
                   ('itm_wait', 'tnt_a', 'ord_a', 'prd_a', 1, 10000, 'Preparing'),
                   ('itm_paid', 'tnt_a', 'ord_paid', 'prd_a', 1, 10000, 'Ready'),
                   ('itm_other', 'tnt_b', 'ord_b', 'prd_b', 1, 500, 'Ready');
         INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
            VALUES ('evt_1', 'tnt_a', 'itm_ready', 'KDS_ITEM', 'ITEM_READY', '{}', '2026-11-13 12:07:30');",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

#[tokio::test]
async fn liste_yalniz_kendi_kiracisinin_acik_adisyondaki_hazir_kalemini_verir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let list = list_pending(&mut conn, "tnt_a", NOW).await.expect("liste");

    assert_eq!(list.len(), 1);
    assert_eq!(list[0].item_id, "itm_ready");
    assert_eq!(list[0].table_name, "Masa 4");
    assert_eq!(list[0].product_name, "Tost");
    assert_eq!(list[0].quantity, 2);
    // Kalem olayı 12:07:30, şimdi 12:10:00: 150 sn.
    assert_eq!(list[0].ready_seconds, 150);

    let other = list_pending(&mut conn, "tnt_b", NOW).await.expect("liste");
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].item_id, "itm_other");
}

#[tokio::test]
async fn olay_yoksa_siparis_guncellemesi_bekleme_suresi_olur() {
    let pool = pool().await;
    sqlx::query("DELETE FROM events")
        .execute(&pool)
        .await
        .expect("olay");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let list = list_pending(&mut conn, "tnt_a", NOW).await.expect("liste");
    assert_eq!(list[0].ready_seconds, 600);
}

#[tokio::test]
async fn teslim_kalemi_listeden_cikarir_ve_ikinci_teslim_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let ids = vec!["itm_ready".to_string()];

    assert_eq!(mark_served(&mut conn, "tnt_a", &ids).await, Ok(1));
    assert!(list_pending(&mut conn, "tnt_a", NOW)
        .await
        .expect("liste")
        .is_empty());
    let status: String =
        sqlx::query_scalar("SELECT status FROM order_items WHERE id = 'itm_ready'")
            .fetch_one(&mut *conn)
            .await
            .expect("durum");
    assert_eq!(status, "Served");

    let again = mark_served(&mut conn, "tnt_a", &ids).await;
    assert!(again.is_err_and(|e| e.starts_with("CONFLICT")));
}

#[tokio::test]
async fn hazir_olmayan_odenmis_ve_baska_kiracinin_kalemi_teslim_edilemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    for id in ["itm_wait", "itm_paid", "itm_other"] {
        let result = mark_served(&mut conn, "tnt_a", &[id.to_string()]).await;
        assert!(result.is_err(), "{id} teslim edilmemeli");
    }
    let other: String = sqlx::query_scalar("SELECT status FROM order_items WHERE id = 'itm_other'")
        .fetch_one(&mut *conn)
        .await
        .expect("durum");
    assert_eq!(other, "Ready");
    assert!(mark_served(&mut conn, "tnt_a", &[]).await.is_err());
}

#[tokio::test]
async fn teslim_stogu_degistirmez() {
    let pool = pool().await;
    sqlx::raw_sql(
        "INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                        remaining_quantity, unit_cost_cents, received_at)
         VALUES ('bat_1', 'tnt_a', 'prd_a', 10, 7, 100, '2026-01-01');",
    )
    .execute(&pool)
    .await
    .expect("parti");
    let mut conn = pool.acquire().await.expect("bağlantı");
    mark_served(&mut conn, "tnt_a", &["itm_ready".to_string()])
        .await
        .expect("teslim");
    let left: f64 =
        sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'")
            .fetch_one(&mut *conn)
            .await
            .expect("stok");
    assert_eq!(left, 7.0);
}

#[test]
fn teslim_kapisi_garson_kasiyer_mudur_sahibe_acik_mutfaga_kapali() {
    use crate::commands::serve_commands::serve_gate;
    for role in ["OWNER", "MANAGER", "WAITER", "CASHIER"] {
        assert!(serve_gate(Some(role), Some("tnt_a")).is_ok(), "{role}");
    }
    for role in ["KITCHEN", "MASTER", "bilinmeyen"] {
        assert!(serve_gate(Some(role), Some("tnt_a")).is_err(), "{role}");
    }
    assert!(serve_gate(None, Some("tnt_a")).is_err());
    for tenant in [None, Some(""), Some("  ")] {
        assert!(serve_gate(Some("WAITER"), tenant).is_err());
    }
}
