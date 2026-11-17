//! Marka ayarı, tahsilatta marka doğrulaması ve mutabakat.

use super::*;
use crate::commands::{CartItemDto, PaymentPayloadDto};
use crate::services::audit_service::AuditLock;
use crate::services::order_settlement::settle_order_payment;
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
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents) VALUES
            ('prd_1', 'tnt_a', 'cat_1', 'Tost', 1000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 50, 50, 100);
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 1000);
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 1000);
         INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) VALUES
            ('itm_1', 'tnt_a', 'ord_1', 'prd_1', 1, 909, 1000, 909, 91, 1000, 'Pending');",
    )
    .execute(&pool)
    .await
    .expect("adisyon");
    pool
}

fn payment(id: &str, method: &str, amount: i64, provider: Option<&str>) -> PaymentPayloadDto {
    PaymentPayloadDto {
        transaction_id: id.to_string(),
        order_id: Some("ord_1".to_string()),
        timestamp: "2026-10-30T10:00:00Z".to_string(),
        method: method.to_string(),
        amount_tendered: amount,
        total_amount: amount,
        items: Vec::<CartItemDto>::new(),
        cashier_id: Some("usr_1".to_string()),
        actor_id: Some("usr_1".to_string()),
        meal_card_provider: provider.map(str::to_string),
        ..PaymentPayloadDto::default()
    }
}

async fn pay(pool: &SqlitePool, payload: &PaymentPayloadDto) -> Result<(), String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    settle_order_payment(&mut tx, &lock, payload, TENANT, "CASHIER").await?;
    tx.commit().await.map_err(|e| e.to_string())
}

async fn report(pool: &SqlitePool) -> Reconciliation {
    let mut conn = pool.acquire().await.expect("bağlantı");
    reconciliation(
        &mut conn,
        TENANT,
        "2000-01-01T00:00:00Z",
        "2100-01-01T00:00:00Z",
    )
    .await
    .expect("mutabakat")
}

#[tokio::test]
async fn markalar_varsayilan_acik_ve_kiraciya_ozeldir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let all = list_settings(&mut conn, TENANT).await.expect("liste");
    assert_eq!(all.len(), 6);
    assert!(all.iter().all(|setting| setting.enabled));

    set_enabled(&mut conn, TENANT, "multinet", false)
        .await
        .expect("kapat");
    let mine = list_settings(&mut conn, TENANT).await.expect("liste");
    assert!(
        !mine
            .iter()
            .find(|s| s.code == "MULTINET")
            .expect("m")
            .enabled
    );
    let other = list_settings(&mut conn, "tnt_b").await.expect("liste");
    assert!(other.iter().all(|setting| setting.enabled));
    assert!(set_enabled(&mut conn, TENANT, "BILINMEYEN", false)
        .await
        .is_err());
}

#[tokio::test]
async fn kapali_marka_tahsilati_reddeder_ve_kayit_birakmaz() {
    let pool = pool().await;
    {
        let mut conn = pool.acquire().await.expect("bağlantı");
        set_enabled(&mut conn, TENANT, "SETCARD", false)
            .await
            .expect("kapat");
    }
    let error = pay(&pool, &payment("txn_1", "MEAL_CARD", 1000, Some("SETCARD")))
        .await
        .expect_err("kapalı marka");
    assert!(error.starts_with("PROVIDER_DISABLED"), "{error}");
    let bad = pay(&pool, &payment("txn_2", "MEAL_CARD", 1000, Some("XYZ"))).await;
    assert!(bad.is_err());
    assert_eq!(report(&pool).await.count, 0);
}

#[tokio::test]
async fn mutabakat_marka_bazinda_toplar_ve_nakiti_karistirmaz() {
    let pool = pool().await;
    pay(&pool, &payment("txn_1", "MEAL_CARD", 300, Some("multinet")))
        .await
        .expect("multinet");
    pay(&pool, &payment("txn_2", "MEAL_CARD", 200, Some("PLUXEE")))
        .await
        .expect("pluxee");
    pay(&pool, &payment("txn_3", "CASH", 100, Some("MULTINET")))
        .await
        .expect("nakit marka yok sayılır");
    pay(&pool, &payment("txn_4", "MEAL_CARD", 150, Some("MULTINET")))
        .await
        .expect("multinet 2");
    pay(&pool, &payment("txn_5", "MEAL_CARD", 250, None))
        .await
        .expect("markasız");

    let result = report(&pool).await;
    assert_eq!(result.total_cents, 900);
    assert_eq!(result.count, 4);
    let rows: Vec<_> = result
        .rows
        .iter()
        .map(|row| (row.provider.as_str(), row.total_cents, row.count))
        .collect();
    assert_eq!(
        rows,
        vec![("MULTINET", 450, 2), ("PLUXEE", 200, 1), ("OTHER", 250, 1)]
    );
}

#[tokio::test]
async fn mutabakat_iadeleri_markadan_net_dusurur() {
    let pool = pool().await;
    pay(&pool, &payment("txn_1", "MEAL_CARD", 300, Some("MULTINET")))
        .await
        .expect("multinet");
    pay(&pool, &payment("txn_2", "MEAL_CARD", 200, Some("PLUXEE")))
        .await
        .expect("pluxee");
    // Nakit iade kaydı yemek kartı mutabakatına girmemeli.
    sqlx::raw_sql(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id,
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) VALUES
          ('ref_1', 'tnt_a', 'txn_1', 'ord_1', 'ref_1', 120, 'hatalı', 'COMPENSATION', 'usr_1', datetime('now')),
          ('ref_2', 'tnt_a', 'txn_2', 'ord_1', 'ref_2', 50, 'nakit', 'CASH', 'usr_1', datetime('now'));",
    )
    .execute(&pool)
    .await
    .expect("iade");

    let result = report(&pool).await;
    assert_eq!(result.refunded_cents, 120);
    assert_eq!(result.total_cents, 380);
    let rows: Vec<_> = result
        .rows
        .iter()
        .map(|row| (row.provider.as_str(), row.total_cents, row.refunded_cents))
        .collect();
    assert_eq!(rows, vec![("MULTINET", 180, 120), ("PLUXEE", 200, 0)]);
}
