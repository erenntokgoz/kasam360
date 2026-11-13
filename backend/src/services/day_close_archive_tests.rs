//! `day_close_archive` testleri: dönem sınırı, kanal toplamları, kiracı yalıtımı.

use super::*;
use crate::services::cash_flow_test_support::*;

async fn close(pool: &sqlx::SqlitePool, tenant: &str, ts: &str, revenue: i64, orders: i64) {
    seed_ledger(
        pool,
        tenant,
        "day:closed",
        "day_close",
        "usr_sahip",
        &serde_json::json!({
            "tenantId": tenant,
            "closedShiftsCount": 1,
            "totalRevenueCents": revenue,
            "totalOrders": orders,
        }),
        ts,
    )
    .await;
}

#[tokio::test]
async fn arsiv_en_yeni_ustte_ve_yalniz_kendi_kiracisini_listeler() {
    let pool = pool().await;
    seed_user(&pool, TENANT_A, "usr_sahip", "Sahip").await;
    close(&pool, TENANT_A, "2026-03-01T23:00:00+00:00", 10_000, 2).await;
    close(&pool, TENANT_B, "2026-03-02T23:00:00+00:00", 99_000, 9).await;
    close(&pool, TENANT_A, "2026-03-02T23:30:00+00:00", 20_000, 3).await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = list(&mut conn, TENANT_A, 50).await.expect("liste");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].total_revenue_cents, 20_000);
    assert_eq!(rows[0].closed_by_name.as_deref(), Some("Sahip"));
    assert_eq!(rows[1].total_orders, 2);
}

#[tokio::test]
async fn detay_yalniz_iki_kapanis_arasindaki_tahsilati_kanallara_boler() {
    let pool = pool().await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_0",
        "txn_0",
        "usr_sahip",
        700,
        0,
        "2026-02-28T10:00:00+00:00",
    )
    .await;
    close(&pool, TENANT_A, "2026-03-01T23:00:00+00:00", 700, 1).await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_1",
        "txn_1",
        "usr_sahip",
        1_000,
        0,
        "2026-03-02T10:00:00+00:00",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_2",
        "txn_2",
        "usr_sahip",
        0,
        2_500,
        "2026-03-02T11:00:00+00:00",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_B,
        "ord_b",
        "txn_b",
        "usr_b",
        9_999,
        0,
        "2026-03-02T11:30:00+00:00",
    )
    .await;
    close(&pool, TENANT_A, "2026-03-02T23:00:00+00:00", 3_500, 2).await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_3",
        "txn_3",
        "usr_sahip",
        5_000,
        0,
        "2026-03-03T10:00:00+00:00",
    )
    .await;

    sqlx::query("INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents) VALUES ('shf_1', ?, 'usr_sahip', 'CLOSED', '2026-03-02 08:00:00', '2026-03-02 22:59:59', 1000, 900, -100)")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("vardiya");
    sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES ('csh_1', ?, 'shf_1', 'IN', 400, 'Bozuk para', 'usr_sahip', '2026-03-02 12:00:00')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("giriş");
    sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES ('csh_2', ?, 'shf_1', 'OUT', 150, 'Gider', 'usr_sahip', '2026-03-02 13:00:00')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("çıkış");
    sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES ('csh_old', ?, 'shf_1', 'IN', 77, 'Eski gün', 'usr_sahip', '2026-03-01 12:00:00')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("eski");

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = list(&mut conn, TENANT_A, 50).await.expect("liste");
    let second = detail(&mut conn, TENANT_A, &rows[0].id)
        .await
        .expect("detay")
        .expect("var");
    assert_eq!((second.cash_cents, second.card_cents), (1_000, 2_500));
    assert_eq!((second.cash_in_cents, second.cash_out_cents), (400, 150));
    assert_eq!(second.shifts.len(), 1);
    assert_eq!(second.shifts[0].difference_cents, Some(-100));
    assert!(second.period_start.is_some());

    let first = detail(&mut conn, TENANT_A, &rows[1].id)
        .await
        .expect("ilk detay")
        .expect("var");
    assert_eq!(first.cash_cents, 700);
    assert!(first.period_start.is_none());
}

#[tokio::test]
async fn baska_kiracinin_kapanisi_ve_baska_tur_kayit_detayi_acilmaz() {
    let pool = pool().await;
    close(&pool, TENANT_A, "2026-03-01T23:00:00+00:00", 1, 1).await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_1",
        "txn_1",
        "usr_sahip",
        1,
        0,
        "2026-03-02T10:00:00+00:00",
    )
    .await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = list(&mut conn, TENANT_A, 10).await.expect("liste");
    assert!(detail(&mut conn, TENANT_B, &rows[0].id)
        .await
        .expect("sorgu")
        .is_none());
    assert!(detail(&mut conn, TENANT_A, "aud_2")
        .await
        .expect("sorgu")
        .is_none());
}
