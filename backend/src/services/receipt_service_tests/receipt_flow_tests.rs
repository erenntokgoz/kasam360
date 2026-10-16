//! Fiş üretimi, parçalı ödeme, kiracı izolasyonu ve arama testleri.

use super::common::*;
use super::*;

// ─── Tek finansal gerçeklik ──────────────────────────────────────────────────

#[tokio::test]
async fn fis_yalniz_tahsilat_kaydindan_uretilir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    // Sipariş PAID ama tahsilat kaydı yok: fiş **olmaz**. Fişin varlığı satış
    // fiilinden değil, tahsilattan gelir.
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 42_000, "PAID").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert!(receipts.is_empty(), "tahsilatsız sipariş fiş üretmemeli");
}

#[tokio::test]
async fn tahsilat_kaydi_tsiparis_tek_fis_uretir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 42_000, "PAID").await;
    let mut payload = payment_payload(Some("ord_1"), 42_000, "CREDIT_CARD");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert_eq!(
        receipts.len(),
        1,
        "bir tahsilat tam olarak bir fiş üretmeli"
    );

    let receipt = &receipts[0];
    assert_eq!(receipt.transaction_id, "txn_1");
    assert_eq!(receipt.id, "txn_1");
    assert_eq!(receipt.order_id.as_deref(), Some("ord_1"));
    assert_eq!(receipt.total_cents, 42_000);
    assert_eq!(receipt.payment_method, "Kredi Kartı");
    assert_eq!(receipt.fiscal_receipt_no.as_deref(), Some("FISC-txn_1"));
}

#[tokio::test]
async fn ayni_siparis_iki_tahsilat_iki_fiştir_tek_tahsilat_bir_fistir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 20_000, "PAID").await;

    let mut first = payment_payload(Some("ord_1"), 20_000, "CASH");
    first["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", first, "2026-05-01 12:00:00").await;

    let mut second = payment_payload(Some("ord_1"), 22_000, "CREDIT_CARD");
    second["transactionId"] = serde_json::json!("txn_2");
    seed_sale_event(&pool, TENANT_A, "txn_2", second, "2026-05-01 12:05:00").await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");

    // İki tahsilat iki ayrı finansal gerçekliktir (parçalı ödeme); her biri kendi
    // fişini taşır ve kimlikleri çakışmaz.
    assert_eq!(receipts.len(), 2);
    let ids: Vec<&str> = receipts.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"txn_1") && ids.contains(&"txn_2"));

    // Tek bir tahsilat ise tekrar üretilmez.
    let single = list(&mut conn, TENANT_A, 1)
        .await
        .expect("sınırlı liste okunur");
    assert_eq!(single.len(), 1);
}

// ─── Kiracı izolasyonu ───────────────────────────────────────────────────────

#[tokio::test]
async fn fis_listesi_baska_tenantin_fisini_gormez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mine = list(&mut conn, TENANT_A, 50)
        .await
        .expect("kendi liste okunur");
    assert_eq!(mine.len(), 1);

    let theirs = list(&mut conn, TENANT_B, 50)
        .await
        .expect("karşı liste okunur");
    assert!(theirs.is_empty(), "çapraz tenant fişi sızmamalı");
}

#[tokio::test]
async fn fis_kimligiyle_arama_yalniz_kendi_tenantinda_calisir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let found = find(&mut conn, TENANT_A, "txn_a")
        .await
        .expect("arama yapılır");
    assert!(found.is_some());

    // Aynı kimlik diğer işletmede aranırsa bulunmaz: kimlik tahmin edilebilir
    // olsa bile fiş sızmaz.
    let cross = find(&mut conn, TENANT_B, "txn_a")
        .await
        .expect("arama yapılır");
    assert!(cross.is_none(), "çapraz tenant fiş erişimi açık kalmış");

    let unknown = find(&mut conn, TENANT_A, "txn_yok")
        .await
        .expect("arama yapılır");
    assert!(unknown.is_none());
}

#[tokio::test]
async fn fis_numarasi_ile_aramak_da_calisir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_abc123");
    seed_sale_event(
        &pool,
        TENANT_A,
        "txn_abc123",
        payload,
        "2026-05-01 12:00:00",
    )
    .await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let found = find(&mut conn, TENANT_A, "FISC-txn_ab")
        .await
        .expect("arama yapılır");
    assert!(found.is_some(), "ekranda görünen fiş numarası bulunmalı");
}

#[tokio::test]
async fn basim_izni_icin_varlik_kontrolu_tenant_kilitlidir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 15_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    assert!(exists(&mut conn, TENANT_A, "txn_a")
        .await
        .expect("kontrol yapılır"));
    assert!(
        !exists(&mut conn, TENANT_B, "txn_a")
            .await
            .expect("kontrol yapılır"),
        "başka tenant'ın fişi basılabilmemeli"
    );
    assert!(!exists(&mut conn, TENANT_A, "txn_yok")
        .await
        .expect("kontrol yapılır"));
}

// ─── Uydurma veri yasağı ─────────────────────────────────────────────────────

#[tokio::test]
async fn kalem_yoksa_alt_toplam_ve_kdv_uretilmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 42_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    let receipt = &receipts[0];

    // Önceden burada `total * 100 / 110` ile KDV uyduruluyordu.
    assert!(!receipt.has_items);
    assert_eq!(receipt.subtotal_cents, 0);
    assert_eq!(receipt.tax_total_cents, 0);
    assert_eq!(receipt.total_cents, 42_000, "gerçek tahsilat korunmalı");
}

#[tokio::test]
async fn kalem_varsa_alt_toplam_kalemlerden_toplanir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(&pool, TENANT_A, "ord_1", "tbl_1", 24_000, "PAID").await;
    seed_order_item(&pool, TENANT_A, "it_1", "ord_1", "prd_1", 2, 18_000, 3_600).await;
    seed_order_item(&pool, TENANT_A, "it_2", "ord_1", "prd_2", 1, 2_000, 400).await;
    let mut payload = payment_payload(Some("ord_1"), 24_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    let receipt = &receipts[0];

    assert!(receipt.has_items);
    assert_eq!(receipt.items.len(), 2);
    assert_eq!(receipt.subtotal_cents, 20_000);
    assert_eq!(receipt.tax_total_cents, 4_000);
}

#[tokio::test]
async fn odeme_yontemi_bilinmiyorsa_nakit_uretilmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 1_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    payload.as_object_mut().expect("nesne").remove("method");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let receipts = list(&mut conn, TENANT_A, 50).await.expect("liste okunur");
    assert_eq!(receipts[0].payment_method, "Belirtilmemiş");
}
