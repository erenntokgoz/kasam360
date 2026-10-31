//! Pano rakamları: tahsil edilen para, KDV hariç kâr, yerel saat ve önceki dönem.

use super::*;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const TENANT: &str = "tnt_a";
const OFFSET: i64 = 180;

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
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Tost', 11000);
         INSERT INTO tables (id, tenant_id, name, status) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'AVAILABLE'),
                                                                ('tbl_2', 'tnt_a', 'Masa 2', 'OCCUPIED');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'PAID', 11000),
                   ('ord_2', 'tnt_a', 'tbl_2', 'IN_PROGRESS', 5000);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, subtotal_cents,
                                  tax_amount_cents, total_cents, stock_source_id)
            VALUES ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 1, 10000, 1000, 11000, 'itm_1');
         INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload)
            VALUES ('evt_1', 'tnt_a', 'itm_1', 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED',
                    '{\"totalCogsCents\":3000,\"untrackedDeficit\":0,\"allocations\":[{\"quantity\":1}]}');
         INSERT INTO refunds (id, tenant_id, original_transaction_id, compensation_txn_id, amount_cents,
                              reason, method, actor_id, created_at)
            VALUES ('ref_1', 'tnt_a', 'txn_1', 'ref_1', 500, 'x', 'CASH', 'usr_1', '2026-10-30 18:30:00');",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    pool
}

async fn sale(pool: &SqlitePool, id: &str, at: &str, amount: i64, discount: i64) {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let ctx = AuditContext::new(
        TENANT.to_string(),
        "usr_1".to_string(),
        "OWNER".to_string(),
        category::ODEME,
        "payment:settled_fifo",
        id.to_string(),
        serde_json::json!({
            "orderId": "ord_1", "totalAmount": amount, "discountCents": discount,
            "cashAmountCents": amount, "cardAmountCents": 0, "mealCardAmountCents": 0,
            "veresiyeAmountCents": 0, "cogsTotalCents": 3000, "orderClosed": true,
            "cogsUntrackedDeficit": 0.0,
        }),
        at.to_string(),
    )
    .expect("kayıt");
    AuditService::append(&mut conn, &lock, &ctx)
        .await
        .expect("defter");
}

async fn board(pool: &SqlitePool, from: &str, to: &str) -> Panorama {
    let mut conn = pool.acquire().await.expect("bağlantı");
    build(&mut conn, TENANT, from, to, 86_400, OFFSET)
        .await
        .expect("pano")
}

const DAY_FROM: &str = "2026-10-30T00:00:00+03:00";
const DAY_TO: &str = "2026-10-30T23:59:59+03:00";

#[tokio::test]
async fn ciro_tahsilattan_kar_kdv_haric_hesaplanir() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:00:00+00:00", 10000, 1000).await;
    let result = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(
        result.current.collected_cents, 10000,
        "adisyon toplamı değil tahsilat"
    );
    assert_eq!(result.current.discount_cents, 1000);
    assert_eq!(result.current.refund_cents, 500);
    assert_eq!(result.current.vat_cents, 1000);
    assert_eq!(result.current.cogs_cents, Some(3000));
    assert_eq!(
        result.current.gross_profit_cents,
        Some(10000 - 500 - 1000 - 3000)
    );
    assert_eq!(result.current.average_ticket_cents, 10000);
}

#[tokio::test]
async fn saat_grafigi_yerel_saati_gosterir() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:15:00+00:00", 10000, 0).await;
    let result = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(result.bucket_kind, "HOUR");
    assert_eq!(result.buckets.len(), 24);
    let evening = result.buckets.iter().find(|b| b.label == "21").expect("21");
    assert_eq!(evening.current_cents, 10000, "18:15 UTC yerelde 21:15");
}

#[tokio::test]
async fn onceki_donem_ayni_saate_hizalanir() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:15:00+00:00", 10000, 0).await;
    sale(&pool, "txn_2", "2026-10-29T18:20:00+00:00", 7000, 0).await;
    let result = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(result.previous.collected_cents, 7000);
    let evening = result.buckets.iter().find(|b| b.label == "21").expect("21");
    assert_eq!(
        (evening.current_cents, evening.previous_cents),
        (10000, 7000)
    );
}

#[tokio::test]
async fn cok_gunlu_donem_gunlere_bolunur_bos_gun_silinmez() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:15:00+00:00", 10000, 0).await;
    let result = board(&pool, "2026-10-24T00:00:00+03:00", DAY_TO).await;
    assert_eq!(result.bucket_kind, "DAY");
    assert_eq!(result.buckets.len(), 7);
    assert_eq!(result.buckets[6].label, "2026-10-30");
    assert_eq!(result.buckets[6].current_cents, 10000);
    assert_eq!(result.buckets[0].current_cents, 0);
}

#[tokio::test]
async fn urun_kari_maliyetle_gelir_maliyetsiz_urun_bos_kalir() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:15:00+00:00", 11000, 0).await;
    let result = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(result.products[0].profit_cents, Some(7000));

    sqlx::query("UPDATE order_items SET stock_source_id = NULL")
        .execute(&pool)
        .await
        .expect("maliyetsiz");
    let unknown = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(unknown.products[0].profit_cents, None);
}

#[tokio::test]
async fn canli_durum_acik_masa_ve_adisyonu_sayar() {
    let pool = pool().await;
    let result = board(&pool, DAY_FROM, DAY_TO).await;
    assert_eq!(result.live.open_tables, 1);
    assert_eq!(result.live.total_tables, 2);
    assert_eq!(result.live.open_orders, 1);
    assert_eq!(result.live.open_order_cents, 5000);
}

#[tokio::test]
async fn bitis_baslangictan_once_olamaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(build(&mut conn, TENANT, DAY_TO, DAY_FROM, 86_400, OFFSET)
        .await
        .is_err());
}

#[tokio::test]
async fn dun_ayni_saate_kadar_kiyaslanir() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-29T08:00:00+00:00", 4000, 0).await;
    sale(&pool, "txn_2", "2026-10-29T18:00:00+00:00", 9000, 0).await;
    let result = board(&pool, DAY_FROM, "2026-10-30T14:00:00+03:00").await;
    assert_eq!(
        result.previous.collected_cents, 4000,
        "dünün akşamı kıyasa girmez"
    );
}

#[tokio::test]
async fn kar_yetkisiz_rolde_bos_doner_sifir_olmaz() {
    let pool = pool().await;
    sale(&pool, "txn_1", "2026-10-30T18:15:00+00:00", 11000, 0).await;
    let mut result = board(&pool, DAY_FROM, DAY_TO).await;
    result.hide_profit();
    assert_eq!(result.current.gross_profit_cents, None);
    assert_eq!(result.current.cogs_cents, None);
    assert_eq!(result.products[0].profit_cents, None);
    assert_eq!(result.current.collected_cents, 11000);
}
