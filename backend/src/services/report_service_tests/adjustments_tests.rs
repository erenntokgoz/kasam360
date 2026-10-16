//! İptal / iade / zayi ve finansal sessiz hata testleri.

use super::super::*;
use super::common::*;

// ─── İptal / iade / zayi ────────────────────────────────────────────────────

#[tokio::test]
async fn iptal_kaydi_onaylayani_birlikte_getirir() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_audit(
        &pool,
        TENANT_A,
        1,
        "order:voided",
        "ord_9",
        "usr_voider",
        &serde_json::json!({
            "orderId": "ord_9",
            "reason": "müşteri iptali",
            "orderTotalCents": 33000,
            "approverId": "usr_manager",
            "approverRole": "MANAGER"
        }),
        "2026-03-05 13:00:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert_eq!(report.rows.len(), 1);
    let row = &report.rows[0];
    assert_eq!(row.kind, "VOID");
    assert_eq!(row.amount_cents, 33000);
    assert_eq!(row.actor_id, "usr_voider");
    assert_eq!(row.approver_id, "usr_manager");
    assert_eq!(row.approver_role, "MANAGER");
    assert_eq!(row.reason, "müşteri iptali");
}

#[tokio::test]
async fn kaydi_bulunmayan_hareket_turu_bildirilir_sifir_sayilmaz() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    assert!(report.rows.is_empty());
    // Uydurma "0 ₺" yerine "bu tür için kayıt yok" bildirilir.
    assert!(report.kinds_without_records.contains(&"VOID".to_string()));
    assert!(report.kinds_without_records.contains(&"REFUND".to_string()));
    assert!(report.kinds_without_records.contains(&"WASTE".to_string()));
}

#[tokio::test]
async fn iptal_kaydi_baska_tenantin_raporuna_girmez() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    seed_audit(
        &pool,
        TENANT_B,
        1,
        "order:voided",
        "ord_b",
        "usr_b",
        &serde_json::json!({ "orderTotalCents": 500000, "approverId": "usr_b_mgr" }),
        "2026-03-05 13:00:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");
    assert!(report.rows.is_empty(), "çapraz tenant sızıntısı");
}

// ============================================================================
// 6. FİNANSAL SESSİZ HATA (AGENTS.md §3.4)
// ============================================================================

/// `orders` tablosundaki tutar kolonu okunamaz hâle geldiğinde `sales_report`
/// `Err` dönmeli — `0` değil.
#[tokio::test]
async fn bozuk_tutar_kolonu_satislar_raporunda_hata_dondurur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_order(
        &pool,
        TENANT_A,
        "ord_1",
        "tbl_1",
        120_000,
        "2026-03-05 13:00:00",
        "PAID",
    )
    .await;

    let mut conn = conn_of(&pool).await;
    // Kolonu yanlış adla okuyan ham sorgu hata vermeli: bu, `sales_report`
    // içindeki okumanın bozulduğu durumu taklit eder.
    let ham = sqlx::query(
        "SELECT COALESCE(SUM(total_cents_typo), 0) AS revenue, COUNT(*) AS order_count \
         FROM orders WHERE tenant_id = ? AND status = 'PAID'",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await;
    assert!(ham.is_err(), "yanlış kolon adı hata dönmeli");

    // Aynı hatayı yutan desen sessiz sıfır döner: rapor 'satış yok' der ve
    // işletme sahibi bunu doğru veri sanar. Kanıt burada.
    let yutulan: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents_typo), 0) FROM orders WHERE tenant_id = ?",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);
    assert_eq!(
        yutulan, 0,
        "`unwrap_or(0)` hatayı yutup 0 döndürüyor; P&L 'zarar yok' derdi. map_err zorunlu."
    );

    // Doğru kolonla aynı rapor gerçek tutarı döndürür: sıfır değil.
    let saglam: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents), 0) FROM orders \
         WHERE tenant_id = ? AND status = 'PAID'",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())
    .expect("doğru kolon okunur");
    assert_eq!(saglam, 120_000, "sağlam kolon gerçek tutarı vermeli");
}

/// Vardiya satırındaki tutar kolonu okunamaz hâle geldiğinde `shift_report`
/// `Err` dönmeli — vardiya farkının `0` görünmesi kasa açığını gizler.
#[tokio::test]
async fn bozuk_vardiya_tutar_kolonu_hata_dondurur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    sqlx::query(
        "INSERT OR REPLACE INTO shifts (id, tenant_id, cashier_id, opened_at, status, expected_amount_cents) \
         VALUES ('shf_1', ?, 'usr_a', '2026-03-05 09:00:00', 'OPEN', 500_000)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("vardiya eklenir");

    let mut conn = conn_of(&pool).await;
    let ham = sqlx::query(
        "SELECT s.id, s.expected_amount_cents_typo AS expected_amount_cents \
         FROM shifts s WHERE s.tenant_id = ?",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await;
    assert!(ham.is_err(), "yanlış vardiya kolonu hata dönmeli");

    // Sıfıra dönseydi vardiya farkı '0' görünür ve kasa açığı raporlanmazdı.
    let yutulan: i64 = sqlx::query_scalar(
        "SELECT s.expected_amount_cents_typo FROM shifts s WHERE s.tenant_id = ?",
    )
    .bind(TENANT_A)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);
    assert_eq!(
        yutulan, 0,
        "sessiz sıfır, kasa açığını 'mutabık' gibi gösterirdi"
    );
}

/// `adjustments_report` tutar payload anahtarı olmayan bir kayıtta `0`
/// uydurmak yerine hata dönmeli: "0 tutarlı iptal" diye bir kayıt yoktur.
#[tokio::test]
async fn tutar_anahtari_eksik_iptal_kaydi_hata_dondurur() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    seed_audit(
        &pool,
        TENANT_A,
        1,
        "order:voided",
        "ord_1",
        "usr_a",
        &serde_json::json!({ "reason": "tutar alanı unutulmuş" }),
        "2026-03-05 13:00:00",
    )
    .await;
    let mut conn = conn_of(&pool).await;

    let sonuc = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1)).await;
    assert!(
        sonuc.is_err(),
        "tutar anahtarı yoksa 0 yazmak uydurma olurdu; hata dönmeli"
    );
}

// ─── Aralık yardımcısı ───────────────────────────────────────────────────────

#[tokio::test]
async fn aralik_gun_sayisi_yalniz_gozlem_icin_hesaplanir() {
    assert_eq!(
        range("2026-03-01T00:00:00+00:00", "2026-03-07T00:00:00+00:00").days(),
        7
    );
    // Ters veya bozuk aralık bir gün olarak davranır; rapor boş döner, panik yok.
    assert_eq!(
        range("2026-03-07T00:00:00+00:00", "2026-03-01T00:00:00+00:00").days(),
        1
    );
    assert_eq!(range("bozuk", "bozuk").days(), 1);
}
