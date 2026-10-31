//! Satış, reçete, iptal, fire ve sayım hareketi kaynağıyla izlenir.

use super::*;
use crate::services::order_stock;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const TENANT: &str = "tnt_a";
const NOW: &str = "2026-10-31T10:00:00+00:00";

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
    ensure_columns(&pool).await.expect("kolon");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO users (id, tenant_id, role, name, pin_hash) VALUES
            ('usr_1', 'tnt_a', 'OWNER', 'Ayşe', 'x'), ('usr_2', 'tnt_a', 'WAITER', 'Mehmet', 'x');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Çay', 100), ('prd_2', 'tnt_a', 'cat_1', 'Tost', 300);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 10, 10, 10), ('bat_2', 'tnt_a', 'prd_2', 10, 10, 50);
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 300);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 300);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status, waiter_id, stock_source_id)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 3, 91, 1000, 273, 27, 300, 'Pending', 'usr_2', 'itm_1');",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

#[tokio::test]
async fn satis_adisyona_ve_garsona_baglanir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    order_stock::deduct_line(&mut conn, TENANT, "itm_1", "prd_1", 3, NOW)
        .await
        .expect("düşüm");
    let rows = list(&mut conn, TENANT, Some("prd_1")).await.expect("liste");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].kind, "SATIS");
    assert_eq!(rows[0].quantity, -3.0);
    assert_eq!(rows[0].order_id.as_deref(), Some("ord_1"));
    assert_eq!(rows[0].actor_name, "Mehmet");
}

#[tokio::test]
async fn iptal_stoga_iade_olarak_ve_gerekcesiyle_gorunur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    order_stock::deduct_line(&mut conn, TENANT, "itm_1", "prd_1", 3, NOW)
        .await
        .expect("düşüm");
    order_stock::release_line(&mut conn, TENANT, "itm_1", "yanlış masa", "usr_1", NOW)
        .await
        .expect("iptal");
    let rows = list(&mut conn, TENANT, Some("prd_1")).await.expect("liste");
    let back = rows.iter().find(|row| row.kind == "IADE").expect("iade");
    assert_eq!(back.quantity, 3.0);
    assert_eq!(back.reason.as_deref(), Some("yanlış masa"));
    assert_eq!(back.actor_name, "Ayşe");
}

#[tokio::test]
async fn zayi_iptali_fire_olur_stok_geri_gelmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    order_stock::deduct_line(&mut conn, TENANT, "itm_1", "prd_1", 3, NOW)
        .await
        .expect("düşüm");
    order_stock::release_line(&mut conn, TENANT, "itm_1", "zayi oldu", "usr_1", NOW)
        .await
        .expect("iptal");
    let rows = list(&mut conn, TENANT, Some("prd_1")).await.expect("liste");
    assert!(rows
        .iter()
        .any(|row| row.kind == "FIRE" && row.quantity == -3.0));
    assert!(!rows.iter().any(|row| row.kind == "IADE"));
}

#[tokio::test]
async fn recete_her_bilesen_icin_ayri_satir_yazar() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let allocations = [
        serde_json::json!({ "componentProductId": "prd_2", "batchId": "bat_2", "quantity": 1.5 }),
        serde_json::json!({ "componentProductId": "prd_2", "batchId": "UNTRACKED_DEFICIT", "quantity": 0.5 }),
        serde_json::json!({ "componentProductId": "prd_1", "batchId": "bat_1", "quantity": 2.0 }),
    ];
    record_allocations(&mut conn, TENANT, "itm_1", "prd_9", &allocations)
        .await
        .expect("kayıt");
    let rows = list(&mut conn, TENANT, Some("prd_2")).await.expect("liste");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].quantity, -2.0);
    assert_eq!(rows[0].reason.as_deref(), Some("Reçeteden düşüm"));
}

#[tokio::test]
async fn sayim_farki_isaretini_korur_diger_isletme_gorunmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    for (quantity, source) in [(-2.0, "cnt_1"), (1.0, "cnt_2")] {
        record(
            &mut conn,
            TENANT,
            StockMove {
                product_id: "prd_2",
                movement_type: "ADJUST",
                quantity,
                actor_id: "usr_1",
                reason: Some("kör sayım farkı"),
                source_type: SOURCE_COUNT,
                source_id: source,
            },
        )
        .await
        .expect("kayıt");
    }
    let rows = list(&mut conn, TENANT, None).await.expect("liste");
    let mut quantities: Vec<f64> = rows.iter().map(|row| row.quantity).collect();
    quantities.sort_by(f64::total_cmp);
    assert_eq!(quantities, vec![-2.0, 1.0]);
    assert!(list(&mut conn, "tnt_b", None)
        .await
        .expect("liste")
        .is_empty());
}

#[tokio::test]
async fn eski_veritabaninda_kolonlar_eklenir() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::query(
        "CREATE TABLE stock_movements (id TEXT, tenant_id TEXT, product_id TEXT, created_at TEXT)",
    )
    .execute(&pool)
    .await
    .expect("tablo");
    ensure_columns(&pool).await.expect("ilk");
    ensure_columns(&pool).await.expect("ikinci");
    let columns: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('stock_movements') WHERE name LIKE 'source_%'",
    )
    .fetch_one(&pool)
    .await
    .expect("kolon");
    assert_eq!(columns, 2);
}
