use super::*;
// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kpi_garson_kalemlerinden_dogru_hesaplanir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(
        &p,
        "tenant_a",
        "ord_1",
        "usr_k",
        "usr_1",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;
    siparis(
        &p,
        "tenant_a",
        "ord_2",
        "usr_k",
        "usr_1",
        10_000,
        "PAID",
        "2026-03-11 12:00:00",
    )
    .await;

    let kpi = kpi_service::kpi(&p, "tenant_a", "2000-01-01", "2100-01-01", Some("usr_1"))
        .await
        .expect("KPI");
    assert_eq!(kpi.len(), 1);
    assert_eq!(kpi[0].item_count, 2, "garsonun iki kalemi olmalı");
    assert_eq!(kpi[0].gross_sales_cents, 30_000);
    assert_eq!(kpi[0].top_product.as_deref(), Some("Espresso a"));
}

#[tokio::test]
async fn kpi_baska_kiraciyi_gormez() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    kasa(&p, "tenant_b", "tbl_2").await;
    urun(&p, "tenant_a", "a").await;
    urun(&p, "tenant_b", "b").await;
    // `users.id` global birincil anahtardır: aynı kimlik iki kiracıda
    // kullanılamaz. Sızıntı testi bu yüzden farklı kimliklerle kurulur.
    kullanici(&p, "tenant_a", "usr_a", "Ayşe A", "WAITER").await;
    kullanici(&p, "tenant_b", "usr_b", "Ayşe B", "WAITER").await;
    kullanici(&p, "tenant_b", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(
        &p,
        "tenant_a",
        "ord_a1",
        "usr_k",
        "usr_a",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;
    siparis(
        &p,
        "tenant_b",
        "ord_b1",
        "usr_k",
        "usr_b",
        99_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;

    let kpi = kpi_service::kpi(&p, "tenant_a", "2000-01-01", "2100-01-01", None)
        .await
        .expect("KPI");
    assert_eq!(kpi.len(), 1, "kiraci A yalnız kendi personelini görmeli");
    assert_eq!(
        kpi[0].gross_sales_cents, 20_000,
        "başka işletmenin cirosu sızdı"
    );
}

#[tokio::test]
async fn kpi_ters_tarih_araligini_reddeder() {
    let p = pool().await;
    let sonuc = kpi_service::kpi(&p, "tenant_a", "2026-03-31", "2026-03-01", None).await;
    assert!(sonuc.is_err(), "ters aralık \"0 satış\" gibi görünmemeli");
}

#[tokio::test]
async fn kpi_cift_ciro_ve_acik_siparis_sayilmaz() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_w", "Garson Mehmet", "WAITER").await;

    // 1. Sipariş: PAID, hem cashier_id hem waiter_id aynı kişi (usr_w).
    // Tutar: 20_000 kuruş. Eski hatada sipariş + kalem toplanıp 40_000 çıkıyordu.
    siparis(
        &p,
        "tenant_a",
        "ord_paid",
        "usr_w",
        "usr_w",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;

    // 2. Sipariş: IN_PROGRESS (30_000 kuruş) - ciroya katılmamalı.
    siparis(
        &p,
        "tenant_a",
        "ord_inprog",
        "usr_w",
        "usr_w",
        30_000,
        "IN_PROGRESS",
        "2026-03-10 12:30:00",
    )
    .await;

    // 3. Sipariş: OPEN (15_000 kuruş) - ciroya katılmamalı.
    siparis(
        &p,
        "tenant_a",
        "ord_open",
        "usr_w",
        "usr_w",
        15_000,
        "OPEN",
        "2026-03-10 12:45:00",
    )
    .await;

    let kpi = kpi_service::kpi(&p, "tenant_a", "2000-01-01", "2100-01-01", Some("usr_w"))
        .await
        .expect("KPI okunmalı");

    assert_eq!(kpi.len(), 1);
    assert_eq!(
        kpi[0].gross_sales_cents, 20_000,
        "Ciro tam 1x sayılmalı, açık siparişler eklenmemeli"
    );
    assert_eq!(
        kpi[0].item_count, 1,
        "Yalnız PAID siparişin kalemi sayılmalı"
    );
}
