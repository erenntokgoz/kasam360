//! Satış, vardiya ve fiş raporu testleri.

use super::super::*;
use super::common::*;

// ─── Satış raporu ────────────────────────────────────────────────────────────

#[tokio::test]
async fn ciro_yalnizca_paid_siparislerden_hesaplanir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_paid",
        "tbl_1",
        45000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_open",
        "tbl_1",
        99000,
        "2026-03-05 12:05:00",
        "OPEN",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(
        report.total_revenue_cents, 45000,
        "açık sipariş cirosa girmemeli"
    );
    assert_eq!(report.total_orders, 1);
    assert_eq!(report.average_order_value_cents, 45000);
}

#[tokio::test]
async fn baska_tenantin_cirosu_rapora_girmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_a",
        "tbl_a",
        10000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    seed_order(
        &pool,
        TENANT_B,
        "ord_b",
        "tbl_b",
        999000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let a_report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("A raporu okunur");
    assert_eq!(
        a_report.total_revenue_cents, 10000,
        "çapraz tenant sızıntısı"
    );
}

#[tokio::test]
async fn tarih_araligi_disi_kalan_siparisler_hicelenmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_inside",
        "tbl_1",
        10000,
        "2026-03-10 12:00:00",
        "PAID",
    )
    .await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_before",
        "tbl_1",
        70000,
        "2025-12-31 23:00:00",
        "PAID",
    )
    .await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_after",
        "tbl_1",
        80000,
        "2026-06-01 09:00:00",
        "PAID",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(
        &mut conn,
        TENANT_A,
        &range("2026-03-01T00:00:00+00:00", "2026-03-31T23:59:59+00:00"),
    )
    .await
    .expect("rapor okunur");

    assert_eq!(
        report.total_orders, 1,
        "yalnız aralıktaki sipariş sayılmalı"
    );
    assert_eq!(report.total_revenue_cents, 10000);
}

#[tokio::test]
async fn odeme_yontemi_yuzdesi_kuru_toplamdan_guncellenir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_audit(
        &pool,
        TENANT_A,
        1,
        "payment:settled_fifo",
        "ord_1",
        "usr_1",
        &serde_json::json!({ "method": "Nakit", "totalAmount": 2500 }),
        "2026-03-05 12:00:00",
    )
    .await;
    seed_audit(
        &pool,
        TENANT_A,
        2,
        "payment:settled_fifo",
        "ord_2",
        "usr_1",
        &serde_json::json!({ "method": "Kredi Kartı", "totalAmount": 7500 }),
        "2026-03-05 12:10:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.payment_methods.len(), 2);
    let nakit = report
        .payment_methods
        .iter()
        .find(|m| m.method == "Nakit")
        .expect("nakit satırı");
    assert_eq!(nakit.amount_cents, 2500);
    assert_eq!(nakit.share_percent, 25);
    let kart = report
        .payment_methods
        .iter()
        .find(|m| m.method == "Kredi Kartı")
        .expect("kart satırı");
    assert_eq!(kart.share_percent, 75);
}

#[tokio::test]
async fn kategori_hacmi_baska_tenant_urununu_saymaz() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_category(&pool, TENANT_A, "cat_a").await;
    seed_category(&pool, TENANT_B, "cat_b").await;
    seed_product(&pool, TENANT_A, "prd_a", "cat_a").await;
    seed_product(&pool, TENANT_B, "prd_b", "cat_b").await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_1",
        "tbl_1",
        30000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    seed_order_item(&pool, "it_1", "ord_1", "prd_a", 3, 30000).await;
    let mut conn = conn_of(&pool).await;

    let report = sales_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.category_volume.len(), 1);
    assert_eq!(report.category_volume[0].name, "cat_a");
    assert_eq!(report.category_volume[0].quantity, 3);
    assert_eq!(report.category_volume[0].total_cents, 30000);
}

// ─── Vardiya raporu ──────────────────────────────────────────────────────────

#[tokio::test]
async fn vardiya_raporu_kasiyer_adini_birlestirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?, ?, 'CASHIER', ?, 1)",
    )
    .bind("usr_cashier")
    .bind(TENANT_A)
    .bind("Elif Kasa")
    .execute(&pool)
    .await
    .expect("kullanıcı eklenir");
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents) \
         VALUES ('shf_1', ?, 'usr_cashier', 'CLOSED', '2026-03-05 08:00:00', '2026-03-05 20:00:00', 10000, 10500, 500)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    let mut conn = conn_of(&pool).await;
    let rows = shift_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("vardiya raporu okunur");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].cashier_name, "Elif Kasa");
    assert_eq!(rows[0].difference_cents, Some(500));
}

#[tokio::test]
async fn vardiya_raporu_baska_tenantin_vardiyasini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) \
         VALUES ('shf_b', ?, 'usr_b', 'OPEN', '2026-03-05 08:00:00', 50000)",
    )
    .bind(TENANT_B)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");
    let mut conn = conn_of(&pool).await;

    let rows = shift_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("vardiya raporu okunur");
    assert!(rows.is_empty(), "çapraz tenant sızıntısı");
}

// ─── Fiş raporu ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn fis_raporu_kalem_toplamini_tek_sorguda_getirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_category(&pool, TENANT_A, "cat_a").await;
    seed_product(&pool, TENANT_A, "prd_a", "cat_a").await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_1",
        "tbl_1",
        42000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    seed_order_item(&pool, "it_1", "ord_1", "prd_a", 2, 20000).await;
    seed_order_item(&pool, "it_2", "ord_1", "prd_a", 1, 22000).await;
    let mut conn = conn_of(&pool).await;

    let rows = receipts_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("fiş raporu okunur");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].item_count, 2);
    assert_eq!(rows[0].items_total_cents, 42000);
    assert_eq!(rows[0].status, "PAID");
}

#[tokio::test]
async fn fis_raporu_baska_tenantin_fisini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_order(
        &pool,
        TENANT_B,
        "ord_b",
        "tbl_b",
        77000,
        "2026-03-05 12:00:00",
        "PAID",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let rows = receipts_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1), 50)
        .await
        .expect("fiş raporu okunur");
    assert!(rows.is_empty(), "çapraz tenant sızıntısı");
}
