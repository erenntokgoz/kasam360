//! İade tavanı, kanal seçimi ve nakit iadenin kasaya etkisi.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

const TENANT: &str = "tnt_a";

async fn pool(sale_method: &str) -> SqlitePool {
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
    sqlx::query(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', 'tnt_a', 'Masa 1');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
            VALUES ('ord_1', 'tnt_a', 'tbl_1', 'PAID', 1000);
         INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
            VALUES ('shf_1', 'tnt_a', 'usr_1', 'OPEN', datetime('now', '-1 hour'), 500);",
    )
    .execute(&pool)
    .await
    .expect("kayıt");
    let payload = serde_json::json!({
        "orderId": "ord_1", "method": sale_method, "totalAmount": 1000,
    });
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload)
         VALUES ('evt_1', 'tnt_a', 'txn_1', 'SALE', 'SALE_SETTLED', ?)",
    )
    .bind(payload.to_string())
    .execute(&pool)
    .await
    .expect("tahsilat");
    pool
}

async fn record(pool: &SqlitePool, id: &str, amount: i64, method: &str) {
    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id,
            compensation_txn_id, amount_cents, reason, method, actor_id)
         VALUES (?, 'tnt_a', 'txn_1', 'ord_1', ?, ?, 'test', ?, 'usr_2')",
    )
    .bind(id)
    .bind(id)
    .bind(amount)
    .bind(method)
    .execute(pool)
    .await
    .expect("iade");
}

async fn plan(pool: &SqlitePool, tenant: &str, amount: i64) -> Result<RefundPlan, String> {
    let mut conn = pool.acquire().await.expect("bağlantı");
    plan_refund(&mut conn, tenant, "txn_1", amount).await
}

#[tokio::test]
async fn iade_tahsilat_tutarini_asamaz_ve_birikimli_sayilir() {
    let pool = pool("CASH").await;
    assert_eq!(
        plan(&pool, TENANT, 1000).await,
        Ok(RefundPlan {
            order_id: Some("ord_1".to_string()),
            method: "CASH",
        })
    );
    record(&pool, "ref_1", 600, "CASH").await;

    assert!(plan(&pool, TENANT, 401)
        .await
        .expect_err("tavan")
        .starts_with("REFUND_EXCEEDS_PAYMENT"));
    assert!(plan(&pool, TENANT, 400).await.is_ok());
}

#[tokio::test]
async fn kanal_kayitli_tahsilattan_gelir() {
    let card = pool("CREDIT_CARD").await;
    assert_eq!(
        plan(&card, TENANT, 100).await.expect("kart").method,
        "CREDIT_CARD"
    );
    let meal = pool("MEAL_CARD").await;
    assert_eq!(
        plan(&meal, TENANT, 100).await.expect("yemek").method,
        "COMPENSATION"
    );
}

#[tokio::test]
async fn bilinmeyen_yontem_reddedilir() {
    let unknown = pool("SPLIT").await;
    assert!(plan(&unknown, TENANT, 100)
        .await
        .expect_err("bilinmeyen")
        .starts_with("INVALID_METHOD"));
}

#[tokio::test]
async fn baska_isletmenin_tahsilati_bulunamaz() {
    let pool = pool("CASH").await;
    assert!(plan(&pool, "tnt_b", 100)
        .await
        .expect_err("kiracı")
        .starts_with("NOT_FOUND"));
}

#[tokio::test]
async fn nakit_iade_acik_vardiya_ister_kart_istemez() {
    let cash = pool("CASH").await;
    let card = pool("CREDIT_CARD").await;
    for pool in [&cash, &card] {
        sqlx::query("UPDATE shifts SET status = 'CLOSED' WHERE tenant_id = 'tnt_a'")
            .execute(pool)
            .await
            .expect("kapat");
    }
    assert!(plan(&cash, TENANT, 100)
        .await
        .expect_err("vardiya")
        .starts_with("SHIFT_REQUIRED"));
    assert!(plan(&card, TENANT, 100).await.is_ok());
}

#[tokio::test]
async fn tamami_iade_edilen_adisyon_tekrar_iade_edilemez() {
    let pool = pool("CASH").await;
    sqlx::query("UPDATE orders SET status = 'COMPENSATED' WHERE id = 'ord_1'")
        .execute(&pool)
        .await
        .expect("durum");
    assert!(plan(&pool, TENANT, 100)
        .await
        .expect_err("durum")
        .starts_with("INVALID_STATE"));
}

#[tokio::test]
async fn nakit_iade_beklenen_kasayi_dusurur_kart_iadesi_dusurmez() {
    let pool = pool("CASH").await;
    let opened_at: String = sqlx::query_scalar("SELECT opened_at FROM shifts WHERE id = 'shf_1'")
        .fetch_one(&pool)
        .await
        .expect("açılış");
    record(&pool, "ref_1", 300, "CASH").await;
    record(&pool, "ref_2", 200, "CREDIT_CARD").await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let calc = crate::commands::cashier_commands::calculate_expected_shift_balance(
        &mut conn, TENANT, "shf_1", &opened_at, None, 500,
    )
    .await
    .expect("hesap");
    assert_eq!(calc.cash_refunds, 300);
    assert_eq!(calc.total_refunds, 500);
    assert_eq!(calc.expected_balance, 200);
}

async fn veresiye_pool() -> SqlitePool {
    let pool = pool("VERESIYE").await;
    sqlx::raw_sql(
        "INSERT INTO directories (id, tenant_id, type, name) VALUES ('dir_1', 'tnt_a', 'CUSTOMER', 'Ayşe');
         INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, order_id)
            VALUES ('dbt_1', 'tnt_a', 'dir_1', 'GIVEN', 1000, 1000, 'PENDING', 'ord_1');",
    )
    .execute(&pool)
    .await
    .expect("borç");
    pool
}

async fn debt(pool: &SqlitePool) -> (i64, i64, String) {
    sqlx::query_as("SELECT total_amount_cents, remaining_amount_cents, status FROM debts")
        .fetch_one(pool)
        .await
        .expect("borç oku")
}

#[tokio::test]
async fn veresiye_iadesi_acik_borcu_azaltir_kasaya_dokunmaz() {
    let pool = veresiye_pool().await;
    assert_eq!(
        plan(&pool, TENANT, 400).await.expect("plan").method,
        "VERESIYE"
    );
    let mut conn = pool.acquire().await.expect("bağlantı");
    reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 400, "usr_1")
        .await
        .expect("iade");
    drop(conn);
    assert_eq!(debt(&pool).await, (600, 600, "PENDING".to_string()));

    let mut conn = pool.acquire().await.expect("bağlantı");
    reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 600, "usr_1")
        .await
        .expect("tam iade");
    drop(conn);
    assert_eq!(debt(&pool).await, (0, 0, "PAID".to_string()));
}

async fn collected(pool: &SqlitePool, cents: i64, method: &str) {
    sqlx::query(
        "INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method, actor_id)
         VALUES ('pay_1', 'tnt_a', 'dbt_1', ?, ?, 'usr_1')",
    )
    .bind(cents)
    .bind(method)
    .execute(pool)
    .await
    .expect("tahsilat");
    sqlx::query(
        "UPDATE debts SET remaining_amount_cents = total_amount_cents - ?, status = 'PARTIAL'",
    )
    .bind(cents)
    .execute(pool)
    .await
    .expect("borç");
}

#[tokio::test]
async fn tahsil_edilmis_nakit_veresiye_kasadan_geri_odenir_ekstre_tutar() {
    let pool = veresiye_pool().await;
    collected(&pool, 700, "CASH").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 500, "usr_1")
        .await
        .expect("iade");
    drop(conn);
    // 300 açık borçtan düşer, 200 nakit geri verilir: 500 satış, 500 net tahsilat.
    assert_eq!(debt(&pool).await, (500, 0, "PAID".to_string()));
    let net: i64 = sqlx::query_scalar("SELECT SUM(amount_cents) FROM debt_payments")
        .fetch_one(&pool)
        .await
        .expect("net");
    assert_eq!(net, 500);
    let out: i64 = sqlx::query_scalar("SELECT amount_cents FROM cash_movements")
        .fetch_one(&pool)
        .await
        .expect("kasa");
    assert_eq!(out, 200);
}

#[tokio::test]
async fn kartla_tahsil_edilen_veresiye_kasaya_dokunmaz_nakitte_vardiya_ister() {
    let pool = veresiye_pool().await;
    collected(&pool, 1000, "CREDIT_CARD").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 100, "usr_1")
        .await
        .expect("kart iadesi");
    drop(conn);
    let moves: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
        .fetch_one(&pool)
        .await
        .expect("kasa");
    assert_eq!(moves, 0);

    let cash = veresiye_pool().await;
    collected(&cash, 1000, "CASH").await;
    sqlx::query("UPDATE shifts SET status = 'CLOSED'")
        .execute(&cash)
        .await
        .expect("kapanış");
    let mut conn = cash.acquire().await.expect("bağlantı");
    let error = reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 100, "usr_1")
        .await
        .expect_err("vardiya yok");
    assert!(error.starts_with("SHIFT_REQUIRED"));
    let excess = reduce_veresiye_debt(&mut conn, TENANT, Some("ord_1"), 1001, "usr_1")
        .await
        .expect_err("toplamı aşar");
    assert!(excess.starts_with("REFUND_EXCEEDS_DEBT"));
}
