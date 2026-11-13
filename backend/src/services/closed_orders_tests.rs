//! `closed_orders` testleri: filtre doğruluğu, özet ve kiracı yalıtımı.

use super::*;
use crate::services::cash_flow_test_support::*;

fn filter() -> ClosedOrderFilter {
    ClosedOrderFilter {
        from: "2026-03-01T00:00:00+00:00".to_string(),
        to: "2026-03-31T23:59:59+00:00".to_string(),
        ..ClosedOrderFilter::default()
    }
}

/// A kiracısında iki kapanmış adisyon, kısmi ödemeli açık bir adisyon;
/// B kiracısında bir kapanmış adisyon.
async fn seeded() -> sqlx::SqlitePool {
    let pool = pool().await;
    for (tenant, id, name) in [
        (TENANT_A, "usr_ali", "Ali"),
        (TENANT_A, "usr_ayse", "Ayşe"),
        (TENANT_B, "usr_bora", "Bora"),
    ] {
        seed_user(&pool, tenant, id, name).await;
    }
    seed_table(&pool, TENANT_A, "tbl_1", "Masa 1").await;
    seed_table(&pool, TENANT_A, "tbl_2", "Bahçe 2").await;
    seed_table(&pool, TENANT_B, "tbl_b", "Masa 1").await;

    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", "PAID", 10_000, "usr_ali").await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_1",
        "txn_1",
        "usr_ayse",
        10_000,
        0,
        "2026-03-02T12:00:00+00:00",
    )
    .await;
    seed_order(
        &pool, TENANT_A, "ord_2", "tbl_2", "PAID", 25_000, "usr_ayse",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_2",
        "txn_2a",
        "usr_ali",
        5_000,
        0,
        "2026-03-03T12:00:00+00:00",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_2",
        "txn_2b",
        "usr_ali",
        0,
        20_000,
        "2026-03-03T12:05:00+00:00",
    )
    .await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_open",
        "tbl_1",
        "IN_PROGRESS",
        9_000,
        "usr_ali",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_A,
        "ord_open",
        "txn_o",
        "usr_ali",
        1_000,
        0,
        "2026-03-03T13:00:00+00:00",
    )
    .await;
    seed_order(
        &pool, TENANT_B, "ord_b", "tbl_b", "PAID", 70_000, "usr_bora",
    )
    .await;
    seed_payment(
        &pool,
        TENANT_B,
        "ord_b",
        "txn_b",
        "usr_bora",
        70_000,
        0,
        "2026-03-03T12:00:00+00:00",
    )
    .await;
    pool
}

#[tokio::test]
async fn liste_yalniz_kendi_kiracisinin_kapanmis_adisyonlarini_dondurur() {
    let pool = seeded().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let result = list(&mut conn, TENANT_A, &filter()).await.expect("liste");
    let ids: Vec<_> = result.rows.iter().map(|r| r.order_id.as_str()).collect();
    assert_eq!(
        ids,
        ["ord_2", "ord_1"],
        "yeni üstte; açık ve B adisyonu yok"
    );
    assert_eq!(result.summary.count, 2);
    assert_eq!(result.summary.paid_cents, 35_000);
}

#[tokio::test]
async fn kapatan_son_tahsilatin_kullanicisidir_acan_siparisin_sahibidir() {
    let pool = seeded().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let rows = list(&mut conn, TENANT_A, &filter())
        .await
        .expect("liste")
        .rows;
    let split = &rows[0];
    assert_eq!(split.opened_by_name.as_deref(), Some("Ayşe"));
    assert_eq!(split.closed_by_name.as_deref(), Some("Ali"));
    assert_eq!((split.cash_cents, split.card_cents), (5_000, 20_000));
    assert_eq!(split.last_transaction_id, "txn_2b");
}

#[tokio::test]
async fn odeme_yontemi_masa_ve_kullanici_filtreleri_dogru_calisir() {
    let pool = seeded().await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mut by_card = filter();
    by_card.method = Some("CARD".to_string());
    let card = list(&mut conn, TENANT_A, &by_card).await.expect("kart");
    assert_eq!(card.summary.count, 1);
    assert_eq!(card.rows[0].order_id, "ord_2");

    let mut by_table = filter();
    by_table.table_search = Some("bahçe".to_string());
    let table = list(&mut conn, TENANT_A, &by_table).await.expect("masa");
    assert_eq!(table.rows.len(), 1);

    let mut by_closer = filter();
    by_closer.closed_by = Some("usr_ayse".to_string());
    let closer = list(&mut conn, TENANT_A, &by_closer)
        .await
        .expect("kapatan");
    assert_eq!(closer.rows[0].order_id, "ord_1");

    let mut by_opener = filter();
    by_opener.opened_by = Some("usr_ayse".to_string());
    let opener = list(&mut conn, TENANT_A, &by_opener).await.expect("açan");
    assert_eq!(opener.rows[0].order_id, "ord_2");
}

#[tokio::test]
async fn tarih_araligi_siralama_ve_ozet_filtreye_uyar() {
    let pool = seeded().await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mut one_day = filter();
    one_day.from = "2026-03-02T00:00:00+00:00".to_string();
    one_day.to = "2026-03-02T23:59:59+00:00".to_string();
    let day = list(&mut conn, TENANT_A, &one_day).await.expect("gün");
    assert_eq!((day.summary.count, day.summary.paid_cents), (1, 10_000));

    let mut by_total = filter();
    by_total.sort = Some("total_asc".to_string());
    let sorted = list(&mut conn, TENANT_A, &by_total).await.expect("sıralı");
    assert_eq!(sorted.rows[0].order_id, "ord_1");

    // Sayfalama özeti küçültmez: özet filtrenin tamamıdır.
    let mut paged = filter();
    paged.limit = Some(1);
    let page = list(&mut conn, TENANT_A, &paged).await.expect("sayfa");
    assert_eq!((page.rows.len(), page.summary.count), (1, 2));
}

#[tokio::test]
async fn gecersiz_yontem_ve_siralama_reddedilir() {
    let pool = seeded().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut bad_method = filter();
    bad_method.method = Some("BITCOIN".to_string());
    assert!(list(&mut conn, TENANT_A, &bad_method).await.is_err());
    let mut bad_sort = filter();
    bad_sort.sort = Some("id; DROP TABLE orders".to_string());
    assert!(list(&mut conn, TENANT_A, &bad_sort).await.is_err());
}

#[tokio::test]
async fn detay_kalem_odeme_iade_ve_iptali_getirir_baska_kiraciyi_gormez() {
    let pool = seeded().await;
    sqlx::query("INSERT INTO categories (id, tenant_id, name, display_order) VALUES ('cat_1', ?, 'İçecek', 0)")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("kategori");
    sqlx::query("INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) VALUES ('prd_1', ?, 'Çay', 5000, 1000, 'cat_1', 1)")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("ürün");
    sqlx::query("INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, status) VALUES ('oi_1', ?, 'ord_2', 'prd_1', 5, 5000, 1000, 22727, 2273, 25000, 'Sent')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("kalem");
    sqlx::query("INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, compensation_txn_id, amount_cents, reason, method, actor_id) VALUES ('ref_1', ?, 'txn_2a', 'ord_2', 'txn_c', 1000, 'Hatalı', 'CASH', 'usr_ali')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("iade");
    seed_ledger(
        &pool,
        TENANT_A,
        "order_item:voided",
        "oi_x",
        "usr_ali",
        &serde_json::json!({ "orderId": "ord_2", "reason": "Yanlış", "amountCents": 500 }),
        "2026-03-03T11:00:00+00:00",
    )
    .await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let d = detail(&mut conn, TENANT_A, "ord_2")
        .await
        .expect("detay")
        .expect("var");
    assert_eq!(d.items.len(), 1);
    assert_eq!(d.items[0].product_name, "Çay");
    assert_eq!(d.payments.len(), 2);
    assert_eq!(d.refunds[0].amount_cents, 1_000);
    assert_eq!((d.voids.len(), d.voids[0].amount_cents), (1, 500));

    assert!(detail(&mut conn, TENANT_B, "ord_2")
        .await
        .expect("sorgu")
        .is_none());
    assert!(detail(&mut conn, TENANT_A, "ord_open")
        .await
        .expect("sorgu")
        .is_none());
}
