use super::*;
// ---------------------------------------------------------------------------
// Bahşiş havuzu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn havuz_toplami_gercek_bahsis_toplamidir() {
    let p = pool().await;
    tip_service::record_tip(&p, "tenant_a", Some("ord_1"), 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");
    tip_service::record_tip(&p, "tenant_a", Some("ord_2"), 3_500, "2026-03-11T12:00:00Z")
        .await
        .expect("bahşiş");
    // Farklı dönem: toplama girmemeli.
    tip_service::record_tip(&p, "tenant_a", Some("ord_3"), 9_000, "2026-04-01T12:00:00Z")
        .await
        .expect("bahşiş");

    let mart = tip_service::pool_total(&p, "tenant_a", "2026-03").await.expect("toplam");
    assert_eq!(mart, 8_500, "dönem filtresi çalışmıyor");
    let nisan = tip_service::pool_total(&p, "tenant_a", "2026-04").await.expect("toplam");
    assert_eq!(nisan, 9_000);
}

#[tokio::test]
async fn havuz_baska_kiraci_tutarini_gormez() {
    let p = pool().await;
    tip_service::record_tip(&p, "tenant_a", None, 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");
    tip_service::record_tip(&p, "tenant_b", None, 77_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let a = tip_service::pool_total(&p, "tenant_a", "2026-03").await.expect("toplam");
    assert_eq!(a, 5_000, "başka işletmenin bahşişi sızdı");
}

#[tokio::test]
async fn dagitimda_kurus_kaybi_olmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_3", "Ceren", "WAITER").await;
    // 100 kuruş, üç eşit olmayan tabana bölünecek: 33/33/34 gibi bir dağılım
    // olmalı ve toplam **tam olarak** 100 kalmalı.
    tip_service::record_tip(&p, "tenant_a", None, 100, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let dagilim = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[
            TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1, multiplier_percent: 100 },
            TipAllocationInput { user_id: "usr_2".into(), basis_cents: 1, multiplier_percent: 100 },
            TipAllocationInput { user_id: "usr_3".into(), basis_cents: 1, multiplier_percent: 100 },
        ],
    )
    .await
    .expect("dağıtım");

    let toplam: i64 = dagilim.iter().map(|d| d.amount_cents).sum();
    assert_eq!(toplam, 100, "dağıtım havuzla uyuşmuyor, {toplam} kuruş dağıtıldı");
    assert!(dagilim.iter().all(|d| d.amount_cents > 0), "bir kişi hiç pay almamalı");

    let ozet = tip_service::pool_summary(&p, "tenant_a", "2026-03").await.expect("özet");
    assert_eq!(ozet.leftover_cents, 0, "dağıtılmamış kuruş kalmalı");
}

#[tokio::test]
async fn dagitim_tabani_sifirsa_hata_verir_kayip_sessizce_olmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    tip_service::record_tip(&p, "tenant_a", None, 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let sonuc = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[TipAllocationInput { user_id: "usr_1".into(), basis_cents: 0, multiplier_percent: 100 }],
    )
    .await;
    assert!(sonuc.is_err(), "sıfır tabanla dağıtım yapılmamalı");

    // Havuz hâlâ tam durmalı: sessizce dağıtılmış gibi görünmemeli.
    let ozet = tip_service::pool_summary(&p, "tenant_a", "2026-03").await.expect("özet");
    assert_eq!(ozet.leftover_cents, 5_000, "hatalı dağıtım havuzu yemiş");
}

#[tokio::test]
async fn katsayi_payagini_gercekten_degistirir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "WAITER").await;
    tip_service::record_tip(&p, "tenant_a", None, 10_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let dagilim = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[
            TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1_000, multiplier_percent: 200 },
            TipAllocationInput { user_id: "usr_2".into(), basis_cents: 1_000, multiplier_percent: 100 },
        ],
    )
    .await
    .expect("dağıtım");

    let a = dagilim.iter().find(|d| d.user_id == "usr_1").expect("kayıt");
    let b = dagilim.iter().find(|d| d.user_id == "usr_2").expect("kayıt");
    assert_eq!(a.amount_cents, 6_666, "200% katsayı iki kat pay vermeli");
    assert_eq!(b.amount_cents, 3_334);
    assert_eq!(a.amount_cents + b.amount_cents, 10_000);
}

#[tokio::test]
async fn bos_havuz_dagitim_hatasi_verir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1_000, multiplier_percent: 100 }],
    )
    .await;
    assert!(sonuc.is_err(), "havuz boşken dağıtım yapılmamalı");
}

#[tokio::test]
async fn negatif_bahsis_kaydedilmez() {
    let p = pool().await;
    let sonuc = tip_service::record_tip(&p, "tenant_a", None, -500, "2026-03-10T12:00:00Z").await;
    assert!(sonuc.is_err(), "negatif bahşiş havuzu küçültürdü");
    let sonuc = tip_service::record_tip(&p, "tenant_a", None, 0, "2026-03-10T12:00:00Z").await;
    assert!(sonuc.is_err(), "sıfır bahşiş kaydı kirlilik üretir");
}

