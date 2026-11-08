use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

async fn pool() -> SqlitePool {
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
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
            VALUES ('usr_a', 'tnt_a', 'WAITER', 'Ali', 'x', 1);
         INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
            VALUES ('shf_a', 'tnt_a', 'usr_a', 'OPEN', datetime('now'), 100000);",
    )
    .execute(&pool)
    .await
    .expect("tohum");
    pool
}

fn expense<'a>(method: &'a str) -> NewExpense<'a> {
    NewExpense {
        category: "OTHER",
        amount_cents: 5_000,
        payment_method: method,
        directory_id: None,
        recurring_id: None,
        actor_id: "usr_a",
        description: Some("Temizlik"),
        expense_date: "2026-10-31",
    }
}

async fn cash_total(pool: &SqlitePool, direction: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements WHERE movement_type = ?",
    )
    .bind(direction)
    .fetch_one(pool)
    .await
    .expect("kasa")
}

#[tokio::test]
async fn nakit_gider_iptali_kasaya_geri_yazar_ve_gideri_arsive_tasir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (id, _) = insert_expense(&mut conn, "tnt_a", &expense("CASH"))
        .await
        .expect("gider");
    void_expense(&mut conn, "tnt_a", &id, "usr_a", "Yanlış giriş")
        .await
        .expect("iptal");
    drop(conn);

    assert_eq!(cash_total(&pool, "OUT").await, 5_000);
    assert_eq!(cash_total(&pool, "IN").await, 5_000);
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM general_expenses")
        .fetch_one(&pool)
        .await
        .expect("sayım");
    assert_eq!(left, 0);
    let reason: String = sqlx::query_scalar("SELECT void_reason FROM voided_expenses")
        .fetch_one(&pool)
        .await
        .expect("arşiv");
    assert_eq!(reason, "Yanlış giriş");
}

#[tokio::test]
async fn kapanmis_vardiyanin_gideri_iptal_edilemez_nedensiz_iptal_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (id, _) = insert_expense(&mut conn, "tnt_a", &expense("BANK_TRANSFER"))
        .await
        .expect("gider");
    assert!(void_expense(&mut conn, "tnt_a", &id, "usr_a", "  ")
        .await
        .is_err());
    sqlx::query("UPDATE shifts SET status = 'CLOSED'")
        .execute(&mut *conn)
        .await
        .expect("kapanış");
    let error = void_expense(&mut conn, "tnt_a", &id, "usr_a", "Hata")
        .await
        .expect_err("kapalı vardiya");
    assert!(error.contains("INVALID_STATE"));
}

#[tokio::test]
async fn baska_kiracinin_gideri_iptal_edilemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let (id, _) = insert_expense(&mut conn, "tnt_a", &expense("CASH"))
        .await
        .expect("gider");
    assert!(void_expense(&mut conn, "tnt_b", &id, "usr_a", "Hata")
        .await
        .is_err());
}

#[tokio::test]
async fn avans_iptali_bordro_kaydini_da_kaldirir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    record_staff_advance(
        &mut conn,
        "tnt_a",
        "usr_a",
        "2026-10",
        2_000,
        "CASH",
        "usr_a",
        "2026-10-31",
    )
    .await
    .expect("avans");
    let expense_id: String = sqlx::query_scalar("SELECT expense_id FROM staff_advances")
        .fetch_one(&mut *conn)
        .await
        .expect("avans satırı");
    void_expense(&mut conn, "tnt_a", &expense_id, "usr_a", "Vazgeçildi")
        .await
        .expect("iptal");
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM staff_advances")
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(left, 0);
}

#[tokio::test]
async fn cekmecede_olmayan_nakit_gider_kaydi_kasayi_eksiye_indirir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut big = expense("CASH");
    big.amount_cents = 100_001;
    insert_expense(&mut conn, "tnt_a", &big)
        .await
        .expect("nakit gider kaydedilmeli");
    drop(conn);
    assert_eq!(cash_total(&pool, "OUT").await, 100_001);
    let expected: i64 = sqlx::query_scalar(
        "SELECT expected_amount_cents - (SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements WHERE tenant_id = 'tnt_a' AND shift_id = 'shf_a' AND movement_type = 'OUT') FROM shifts WHERE tenant_id = 'tnt_a' AND id = 'shf_a'",
    ).fetch_one(&pool).await.expect("kasa bakiyesi");
    assert_eq!(expected, -1);
}
