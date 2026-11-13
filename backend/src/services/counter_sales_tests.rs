//! Tezgâh satış özeti: yalnız tezgâh adisyonları, kiracıya kapalı, dönem sınırlı.

use super::*;
use sqlx::sqlite::SqlitePoolOptions;

async fn ledger(pool: &sqlx::SqlitePool, n: i64, tenant: &str, ts: &str, payload: &str) {
    sqlx::query(
        "INSERT INTO audit_ledger (id, tenant_id, sequence, timestamp, actor_id, actor_role,
                                   action, resource_id, payload, previous_hash, current_hash)
         VALUES (?, ?, ?, ?, 'usr_1', 'CASHIER', 'payment:settled_fifo', 'r', ?, ?, ?)",
    )
    .bind(format!("aud_{n}"))
    .bind(tenant)
    .bind(n)
    .bind(ts)
    .bind(payload)
    .bind(format!("{:064x}", n - 1))
    .bind(format!("{n:064x}"))
    .execute(pool)
    .await
    .expect("defter");
}

fn pay(order: &str, cents: i64, method: &str) -> String {
    format!(r#"{{"orderId":"{order}","totalAmount":{cents},"orderClosed":1,"method":"{method}"}}"#)
}

#[tokio::test]
async fn ozet_yalniz_tezgah_adisyonlarini_ve_kendi_kiracisini_sayar() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO tables (id, tenant_id, name) VALUES
            ('tbl_counter_tnt_a', 'tnt_a', 'Tezgâh'), ('tbl_1', 'tnt_a', 'Masa 1'),
            ('tbl_counter_tnt_b', 'tnt_b', 'Tezgâh');
         INSERT INTO orders (id, tenant_id, table_id, status, total_cents) VALUES
            ('ord_c1', 'tnt_a', 'tbl_counter_tnt_a', 'PAID', 5000),
            ('ord_c2', 'tnt_a', 'tbl_counter_tnt_a', 'PAID', 2500),
            ('ord_m', 'tnt_a', 'tbl_1', 'PAID', 9000),
            ('ord_b', 'tnt_b', 'tbl_counter_tnt_b', 'PAID', 7000);",
    )
    .execute(&pool)
    .await
    .expect("veri");
    ledger(
        &pool,
        1,
        "tnt_a",
        "2026-11-13T10:00:00+00:00",
        &pay("ord_c1", 5000, "CASH"),
    )
    .await;
    ledger(
        &pool,
        2,
        "tnt_a",
        "2026-11-13T11:00:00+00:00",
        &pay("ord_c2", 2500, "CARD"),
    )
    .await;
    ledger(
        &pool,
        3,
        "tnt_a",
        "2026-11-13T11:30:00+00:00",
        &pay("ord_m", 9000, "CASH"),
    )
    .await;
    ledger(
        &pool,
        4,
        "tnt_b",
        "2026-11-13T11:30:00+00:00",
        &pay("ord_b", 7000, "CASH"),
    )
    .await;
    ledger(
        &pool,
        5,
        "tnt_a",
        "2026-11-12T11:00:00+00:00",
        &pay("ord_c1", 100, "CASH"),
    )
    .await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let range = ReportRange::new("2026-11-13T00:00:00+00:00", "2026-11-14T00:00:00+00:00");
    let summary = counter_sales_summary(&mut conn, "tnt_a", &range)
        .await
        .expect("özet");

    assert_eq!(summary.total_revenue_cents, 7500);
    assert_eq!(summary.total_orders, 2);
    assert_eq!(summary.average_order_value_cents, 3750);
    assert_eq!(
        summary.payment_methods,
        vec![
            CounterPaymentShareDto {
                method: "CASH".into(),
                amount_cents: 5000
            },
            CounterPaymentShareDto {
                method: "CARD".into(),
                amount_cents: 2500
            },
        ]
    );
}
