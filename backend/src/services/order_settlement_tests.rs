//! Tam, tutara, kaleme ve adede göre tahsilat; çift ödeme ve tek stok düşümü.

use super::*;
use crate::commands::PaymentPayloadDto;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tokio::sync::Mutex;

const TENANT: &str = "tnt_a";

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
         INSERT INTO products (id, tenant_id, category_id, name, price_cents) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Çay', 100), ('prd_2', 'tnt_a', 'cat_1', 'Tost', 3000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 50, 50, 10), ('bat_2', 'tnt_a', 'prd_2', 50, 50, 500);
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 3300);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 3300);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) VALUES
            ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 3, 91, 1000, 273, 27, 300, 'Pending'),
            ('itm_2', 'tnt_a', 'ord_1', 'prd_2', 1, 2727, 1000, 2727, 273, 3000, 'Pending');
         INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_a', 'Ayşe', 'CUSTOMER');",
    )
    .execute(&pool)
    .await
    .expect("adisyon");
    pool
}

fn payment(id: &str, method: &str, amount: i64, items: &[(&str, i64)]) -> PaymentPayloadDto {
    PaymentPayloadDto {
        transaction_id: id.to_string(),
        order_id: Some("ord_1".to_string()),
        timestamp: "2026-10-30T10:00:00Z".to_string(),
        method: method.to_string(),
        amount_tendered: amount,
        total_amount: amount,
        change_amount: None,
        items: items
            .iter()
            .map(|(item, quantity)| CartItemDto {
                id: (*item).to_string(),
                product: serde_json::json!({}),
                quantity: *quantity,
                ..CartItemDto::default()
            })
            .collect(),
        splits: None,
        notes: None,
        customer_ref: None,
        cashier_id: Some("usr_1".to_string()),
        terminal_id: None,
        idempotency_key: None,
        global_discount: None,
        approval_token: None,
        actor_id: Some("usr_1".to_string()),
        debt_directory_id: None,
    }
}

async fn pay(pool: &SqlitePool, payload: &PaymentPayloadDto) -> Result<Settlement, String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let result = settle_order_payment(&mut tx, &lock, payload, TENANT, "CASHIER").await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

async fn scalar(pool: &SqlitePool, query: &str) -> i64 {
    sqlx::query_scalar(query)
        .fetch_one(pool)
        .await
        .expect("sorgu")
}

async fn stock(pool: &SqlitePool, batch: &str) -> f64 {
    sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = ?")
        .bind(batch)
        .fetch_one(pool)
        .await
        .expect("stok")
}

#[tokio::test]
async fn tam_tahsilat_adisyonu_kapatir_masayi_bosaltir_stogu_bir_kez_duser() {
    let p = pool().await;
    let done = pay(&p, &payment("txn_1", "CASH", 3300, &[]))
        .await
        .expect("ödeme");
    assert!(done.order_closed);
    assert_eq!(done.remaining_cents, 0);
    assert_eq!(
        scalar(&p, "SELECT COUNT(*) FROM orders WHERE status = 'PAID'").await,
        1
    );
    assert_eq!(
        scalar(&p, "SELECT COUNT(*) FROM tables WHERE status = 'AVAILABLE' AND current_total = 0 AND opened_at IS NULL").await,
        1
    );
    assert_eq!(stock(&p, "bat_1").await, 47.0);
    assert_eq!(stock(&p, "bat_2").await, 49.0);
    let again = pay(&p, &payment("txn_2", "CASH", 100, &[])).await;
    assert!(again.err().is_some_and(|e| e.starts_with("ORDER_CLOSED")));
    assert_eq!(stock(&p, "bat_1").await, 47.0);
}

#[tokio::test]
async fn parcali_tutar_kalan_bakiyeyi_izler_stok_yalniz_son_odemede_tam_duser() {
    let p = pool().await;
    let first = pay(&p, &payment("txn_1", "CARD", 1300, &[]))
        .await
        .expect("ilk");
    assert_eq!((first.remaining_cents, first.order_closed), (2000, false));
    assert_eq!(scalar(&p, "SELECT current_total FROM tables").await, 2000);
    assert_eq!(stock(&p, "bat_1").await, 50.0, "ara ödemede stok düşmez");

    let last = pay(&p, &payment("txn_2", "CASH", 2000, &[]))
        .await
        .expect("son");
    assert!(last.order_closed);
    assert_eq!(stock(&p, "bat_1").await, 47.0, "bütün kalemler düşer");
    assert_eq!(stock(&p, "bat_2").await, 49.0);
    let events = "SELECT COUNT(*) FROM events WHERE event_type = 'FIFO_STOCK_DEDUCTED'";
    assert_eq!(scalar(&p, events).await, 1, "stok tek kez düşer");
}

#[tokio::test]
async fn fazla_tahsilat_ve_nakit_para_ustu_kalana_yazilmaz() {
    let p = pool().await;
    let error = pay(&p, &payment("txn_1", "CARD", 3301, &[]))
        .await
        .err()
        .expect("red");
    assert!(error.starts_with("OVERPAYMENT"), "{error}");

    let mut cash = payment("txn_2", "CASH", 1000, &[]);
    cash.amount_tendered = 2000;
    let done = pay(&p, &cash).await.expect("nakit");
    assert_eq!(done.remaining_cents, 2300, "para üstü ödeme sayılmaz");
}

#[tokio::test]
async fn ayni_adet_iki_kez_odenemez_adetler_kurus_kaybetmez() {
    let p = pool().await;
    for (id, share) in [("txn_1", 100), ("txn_2", 100)] {
        pay(&p, &payment(id, "CARD", share, &[("itm_1", 1)]))
            .await
            .expect("adet");
    }
    let error = pay(&p, &payment("txn_3", "CARD", 200, &[("itm_1", 2)]))
        .await
        .err()
        .expect("red");
    assert!(error.starts_with("ITEM_ALREADY_PAID"), "{error}");
    assert_eq!(
        scalar(
            &p,
            "SELECT paid_quantity FROM order_items WHERE id = 'itm_1'"
        )
        .await,
        2
    );
    let done = pay(&p, &payment("txn_4", "CARD", 100, &[("itm_1", 1)]))
        .await
        .expect("son adet");
    assert_eq!(done.remaining_cents, 3000);
}

#[tokio::test]
async fn kalem_tutari_adisyondan_dogrulanir_baska_adisyon_kalemi_reddedilir() {
    let p = pool().await;
    let wrong = pay(&p, &payment("txn_1", "CARD", 1, &[("itm_2", 1)]))
        .await
        .err()
        .expect("red");
    assert!(wrong.starts_with("TOTAL_MISMATCH"), "{wrong}");
    assert_eq!(
        scalar(
            &p,
            "SELECT paid_quantity FROM order_items WHERE id = 'itm_2'"
        )
        .await,
        0,
        "transaction düşünce kalem ödenmiş kalmaz"
    );
    let foreign = pay(&p, &payment("txn_2", "CARD", 100, &[("itm_x", 1)]))
        .await
        .err()
        .expect("red");
    assert!(foreign.starts_with("NOT_FOUND"), "{foreign}");
}

#[tokio::test]
async fn ayni_islem_kimligi_ikinci_kez_para_almaz() {
    let p = pool().await;
    pay(&p, &payment("txn_1", "CARD", 300, &[]))
        .await
        .expect("ödeme");
    let retry = pay(&p, &payment("txn_1", "CARD", 300, &[]))
        .await
        .err()
        .expect("red");
    assert!(retry.starts_with("IDEMPOTENCY_CONFLICT"), "{retry}");
    let mut conn = p.acquire().await.expect("bağlantı");
    let balance = order_balance(&mut conn, TENANT, "ord_1")
        .await
        .expect("bakiye");
    assert_eq!(balance.paid_cents, 300);
}

#[tokio::test]
async fn parcali_veresiye_borc_acar_kartsiz_veresiye_hic_yazmaz() {
    let p = pool().await;
    let error = pay(&p, &payment("txn_1", "VERESIYE", 1000, &[]))
        .await
        .err()
        .expect("red");
    assert!(error.contains("cari kartı"), "{error}");
    assert_eq!(scalar(&p, "SELECT COUNT(*) FROM events").await, 0);

    let mut veresiye = payment("txn_2", "VERESIYE", 1000, &[]);
    veresiye.debt_directory_id = Some("dir_1".to_string());
    let done = pay(&p, &veresiye).await.expect("veresiye");
    assert_eq!(done.remaining_cents, 2300);
    assert_eq!(
        scalar(&p, "SELECT remaining_amount_cents FROM debts WHERE order_id = 'ord_1' AND directory_id = 'dir_1'").await,
        1000
    );
    pay(&p, &payment("txn_3", "CARD", 2300, &[]))
        .await
        .expect("kalan kart");
    assert_eq!(scalar(&p, "SELECT COUNT(*) FROM debts").await, 1);
}

#[tokio::test]
async fn indirim_onaysiz_gecmez_ve_yalniz_kapanista_uygulanir() {
    let p = pool().await;
    let mut partial = payment("txn_1", "CARD", 1000, &[]);
    partial.global_discount = Some(serde_json::json!({ "type": "FIXED_AMOUNT", "value": 300 }));
    assert!(pay(&p, &partial).await.is_err());

    let mut closing = payment("txn_2", "CARD", 3000, &[]);
    closing.global_discount = Some(serde_json::json!({ "type": "FIXED_AMOUNT", "value": 300 }));
    let error = pay(&p, &closing).await.err().expect("jetonsuz red");
    assert!(
        error.contains("TOKEN") || error.contains("token") || error.contains("onay"),
        "{error}"
    );
    assert_eq!(
        scalar(&p, "SELECT COUNT(*) FROM orders WHERE status = 'PAID'").await,
        0
    );
}

#[tokio::test]
async fn bilinmeyen_yontem_reddedilir_karta_sayilmaz() {
    let p = pool().await;
    let error = pay(&p, &payment("txn_1", "BITCOIN", 100, &[]))
        .await
        .err()
        .expect("red");
    assert!(error.starts_with("INVALID_METHOD"), "{error}");
}
