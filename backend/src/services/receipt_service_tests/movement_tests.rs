//! Finansal hareketler ve değişmezlik testleri.

use super::common::*;
use super::*;

// ─── Hesap Defteri hareketleri ───────────────────────────────────────────────

#[tokio::test]
async fn finansal_hareket_turleri_tek_listede_donusur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-02 10:00:00").await;

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at) \
         VALUES ('shf_1', ?, 'usr_1', 'OPEN', '2026-05-02 09:00:00')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id) \
         VALUES ('cmv_1', ?, 'shf_1', 'OUT', 5_000, 'Tedarikçi ödemesi', 'usr_1')",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("kasa hareketi eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı");
    let movements = list_financial_movements(&mut conn, TENANT_A, FROM, TO, 50)
        .await
        .expect("hareketler okunur");

    assert_eq!(movements.len(), 2);

    let sale = movements
        .iter()
        .find(|m| m.movement_type == MOVEMENT_SALE_PAYMENT)
        .expect("tahsilat hareketi listelenmeli");
    let cash = movements
        .iter()
        .find(|m| m.movement_type == MOVEMENT_CASH_MOVEMENT)
        .expect("kasa hareketi listelenmeli");

    // Tahsilatın fişi vardır; kasa çıkışının fişi yoktur ve bu **açık** bir
    // durumdur (`receipt_id: None`).
    assert_eq!(sale.receipt_id.as_deref(), Some("txn_1"));
    assert!(sale.fiscal_receipt_no.is_some());
    assert_eq!(cash.receipt_id, None);
    assert_eq!(
        cash.amount_cents, -5_000,
        "kasa çıkışı negatif işaretlenmeli"
    );
}

#[tokio::test]
async fn finansal_hareket_listesi_tenant_kilitli() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_a");
    seed_sale_event(&pool, TENANT_A, "txn_a", payload, "2026-05-02 10:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let mine = list_financial_movements(&mut conn, TENANT_A, FROM, TO, 50)
        .await
        .expect("kendi hareketler okunur");
    assert_eq!(mine.len(), 1);

    let theirs = list_financial_movements(&mut conn, TENANT_B, FROM, TO, 50)
        .await
        .expect("karşı hareketler okunur");
    assert!(theirs.is_empty());
}

#[tokio::test]
async fn aralik_disindaki_hareketler_listelenmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 30_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-02 10:00:00").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let outside = list_financial_movements(
        &mut conn,
        TENANT_A,
        "2027-01-01 00:00:00",
        "2027-12-31 23:59:59",
        50,
    )
    .await
    .expect("liste okunur");
    assert!(outside.is_empty());
}

// ─── Değişmezlik ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn fis_tablosu_yoktur_kayit_uretmez() {
    // Fişin kalıcı satırı yoktur; finansal geçmiş `events` + `audit_ledger`
    // içinde yaşar. Servisin hiçbir yolu INSERT/UPDATE/DELETE içermez.
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut payload = payment_payload(None, 10_000, "CASH");
    payload["transactionId"] = serde_json::json!("txn_1");
    seed_sale_event(&pool, TENANT_A, "txn_1", payload, "2026-05-01 12:00:00").await;

    let mut conn = pool.acquire().await.expect("bağlantı");
    list(&mut conn, TENANT_A, 50).await.expect("liste okunur");

    // Aynı fiş tekrar okunduğunda içerik birebir aynıdır: hiçbir yazma olmadı.
    let first = find(&mut conn, TENANT_A, "txn_1")
        .await
        .expect("okunur")
        .expect("fiş bulunur");
    let second = find(&mut conn, TENANT_A, "txn_1")
        .await
        .expect("okunur")
        .expect("fiş bulunur");
    assert_eq!(first.id, second.id);
    assert_eq!(first.total_cents, second.total_cents);
    assert_eq!(first.payment_method, second.payment_method);
    assert_eq!(first.created_at, second.created_at);
    assert_eq!(first.fiscal_receipt_no, second.fiscal_receipt_no);
}

#[test]
fn fis_numarasi_bos_islemde_uretulmez() {
    assert_eq!(fiscal_receipt_no(""), None);
    assert_eq!(fiscal_receipt_no("abc"), Some("FISC-abc".to_string()));
}
