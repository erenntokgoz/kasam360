//! Kupon uygulama testleri: kasada geçen senaryo.
//!
//! Kasa beş kapıdan geçer ve her biri **kendi hatasını** döndürür: bilinmeyen
//! kod, pasif kampanya, tarih penceresi, kullanım limiti, asgari sepet. Tek bir
//! "kupon geçersiz" mesajı müşteri kasada beklerken ne yapılacağını söylemez.
//!
//! Kapıyı geçen kupon sayacı bir artırır; geçemeyen kupon sayacı **dokunmaz**.
//! Son kural testleri bunu ayrıca doğrular: müşteri vazgeçse bile sayaç
//! ilerlemesi kuponu gereksiz yere tüketirdi.

use super::support::{bugun, conn_of, gun, kampanya_girdisi, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::campaigns::{
    apply_campaign, campaign_stats, list_campaign_templates, save_campaign,
};

#[tokio::test]
async fn kupon_uzerinde_yuzde_indirim_uygulanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Yuzde", r#"{"discount_percent":25}"#, Some("yuzde25")),
    )
    .await
    .expect("kampanya");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "yuzde25", 4000, false)
        .await
        .expect("kupon uygulanmali");
    assert_eq!(sonuc.discount_cents, 1000);
    assert_eq!(sonuc.remaining_total_cents, 3000);
    assert_eq!(sonuc.usage_count, 1, "ilk kullanimda sayac 1 olmali");
}

#[tokio::test]
async fn kupon_kodu_buyuk_harfle_normalize_eder() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Kahvaltı", r#"{"discount_percent":10}"#, Some("kahvalti10")),
    )
    .await
    .expect("kampanya");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "KAHVALTI10", 10000, false)
        .await
        .expect("kucuk harfli yazilan kupon kabul edilmeli");
    assert_eq!(sonuc.discount_cents, 1000);
}

#[tokio::test]
async fn kupon_sayaci_her_kullanimda_artar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Sayac", r#"{"discount_percent":10}"#, Some("sayac")),
    )
    .await
    .expect("kampanya");

    for beklenen in 1..=3 {
        let sonuc = apply_campaign(&mut conn, KIRACI_A, "sayac", 10000, false)
            .await
            .expect("kupon uygulanmali");
        assert_eq!(sonuc.usage_count, beklenen);
    }

    let istatistik = campaign_stats(&mut conn, KIRACI_A)
        .await
        .expect("istatistik okunmali");
    assert_eq!(istatistik.total_usage, 3, "sayac kalici olarak artmali");
}

#[tokio::test]
async fn kupon_kullanim_limitinde_dolunca_kapanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut girdi = kampanya_girdisi("Limitli", r#"{"discount_percent":10}"#, Some("limitli"));
    girdi.max_usage = Some(1);
    save_campaign(&mut conn, KIRACI_A, "usr_sahip", girdi)
        .await
        .expect("kampanya");

    apply_campaign(&mut conn, KIRACI_A, "limitli", 10000, false)
        .await
        .expect("ilk kullanim");

    let hata = apply_campaign(&mut conn, KIRACI_A, "limitli", 10000, false)
        .await
        .expect_err("limit dolduktan sonra kupon kullanilamamali");
    assert!(
        hata.starts_with("KUPON_TUKENDI"),
        "limit dolduysa 'gecersiz' degil 'tukendi' denmeli: {hata}"
    );

    let istatistik = campaign_stats(&mut conn, KIRACI_A)
        .await
        .expect("istatistik okunmali");
    assert_eq!(
        istatistik.exhausted_campaigns, 1,
        "aktif ama tukenmis kampanya ayri sayilmali"
    );
    assert_eq!(
        istatistik.active_campaigns, 1,
        "kampanya pasif degil, tukenmis"
    );
}

#[tokio::test]
async fn asgari_sepet_kurali_uygulanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi(
            "Minimum",
            r#"{"min_total_cents":20000,"discount_percent":10}"#,
            Some("min20"),
        ),
    )
    .await
    .expect("kampanya");

    let hata = apply_campaign(&mut conn, KIRACI_A, "min20", 15000, false)
        .await
        .expect_err("asgari sepet altinda kupon reddedilmeli");
    assert!(hata.starts_with("KUPON_GECERSIZ"), "{hata}");
    assert!(hata.contains("20000"), "hata esigi belirtmeli: {hata}");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "min20", 20000, false)
        .await
        .expect("asgari sepete kupon uygulanmali");
    assert_eq!(sonuc.discount_cents, 2000);
}

#[tokio::test]
async fn bilinmeyen_kupon_kabul_edilmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = apply_campaign(&mut conn, KIRACI_A, "olmayan", 10000, false)
        .await
        .expect_err("bilinmeyen kupon reddedilmeli");
    assert!(hata.starts_with("KUPON_GECERSIZ"), "{hata}");

    let hata = apply_campaign(&mut conn, KIRACI_A, "   ", 10000, false)
        .await
        .expect_err("bos kupon reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn negatif_sepet_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Negatif", r#"{"discount_percent":10}"#, Some("neg")),
    )
    .await
    .expect("kampanya");

    let hata = apply_campaign(&mut conn, KIRACI_A, "neg", -500, false)
        .await
        .expect_err("negatif sepet reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn pasif_kampanya_kuponu_gecersizdir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Kapali", r#"{"discount_percent":10}"#, Some("kapali")),
    )
    .await
    .expect("kampanya");

    let mut pasif = kampanya_girdisi("Kapali", r#"{"discount_percent":10}"#, Some("kapali"));
    pasif.id = Some(kampanya.id.clone());
    pasif.is_active = Some(false);
    save_campaign(&mut conn, KIRACI_A, "usr_sahip", pasif)
        .await
        .expect("pasiflestirilmeli");

    let hata = apply_campaign(&mut conn, KIRACI_A, "kapali", 10000, false)
        .await
        .expect_err("pasif kampanya kuponu kullanilamamali");
    assert!(hata.contains("pasif"), "{hata}");
}

#[tokio::test]
async fn tarih_penceresi_disi_kupon_gecersizdir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut gecmis = kampanya_girdisi("Bitti", r#"{"discount_percent":10}"#, Some("bitti"));
    gecmis.valid_to = Some(gun(-1));
    save_campaign(&mut conn, KIRACI_A, "usr_sahip", gecmis)
        .await
        .expect("kampanya");

    let hata = apply_campaign(&mut conn, KIRACI_A, "bitti", 10000, false)
        .await
        .expect_err("suresi dolmus kupon reddedilmeli");
    assert!(hata.contains("süresi doldu"), "{hata}");

    let mut gelecek = kampanya_girdisi("Gelecek", r#"{"discount_percent":10}"#, Some("gelecek"));
    gelecek.valid_from = Some(gun(5));
    save_campaign(&mut conn, KIRACI_A, "usr_sahip", gelecek)
        .await
        .expect("kampanya");

    let hata = apply_campaign(&mut conn, KIRACI_A, "gelecek", 10000, false)
        .await
        .expect_err("henuz baslamamis koupon reddedilmeli");
    assert!(hata.contains("başlıyor"), "{hata}");
}

#[tokio::test]
async fn baslangic_tarihi_bugun_kabul_edilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut bugun_girdi = kampanya_girdisi("Bugun", r#"{"discount_percent":10}"#, Some("bugun"));
    bugun_girdi.valid_from = Some(bugun());
    save_campaign(&mut conn, KIRACI_A, "usr_sahip", bugun_girdi)
        .await
        .expect("kampanya");

    assert!(
        apply_campaign(&mut conn, KIRACI_A, "bugun", 10000, false)
            .await
            .is_ok(),
        "bugun baslayan kampanya bugun kullanilabilmeli"
    );
}

#[tokio::test]
async fn urun_kapsami_disinda_kupon_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi(
            "Kahve",
            r#"{"discount_percent":10,"product_ids":["prd_kahve"]}"#,
            Some("kahve"),
        ),
    )
    .await
    .expect("kampanya");

    let hata = apply_campaign(&mut conn, KIRACI_A, "kahve", 10000, false)
        .await
        .expect_err("kapsam disi sepette kupon reddedilmeli");
    assert!(hata.starts_with("KUPON_KAPSAM_DISI"), "{hata}");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "kahve", 10000, true)
        .await
        .expect("kapsam icinde kupon uygulanmali");
    assert_eq!(sonuc.discount_cents, 1000);
}

#[tokio::test]
async fn sabit_indirim_kurali_uygulanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Sabit", r#"{"fixed_discount_cents":500}"#, Some("sabit500")),
    )
    .await
    .expect("kampanya");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "sabit500", 2000, false)
        .await
        .expect("sabit indirim uygulanmali");
    assert_eq!(sonuc.discount_cents, 500);
    assert_eq!(sonuc.remaining_total_cents, 1500);
}

#[tokio::test]
async fn basarisiz_kullanim_sayaci_iletmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Kapsamlı kupon: sepet kapsam dışıyken reddedilir.
    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi(
            "Kahve",
            r#"{"discount_percent":10,"product_ids":["prd_kahve"]}"#,
            Some("sayac"),
        ),
    )
    .await
    .expect("kampanya");

    apply_campaign(&mut conn, KIRACI_A, "sayac", 10000, true)
        .await
        .expect("kapsam icinde kullanilir");
    apply_campaign(&mut conn, KIRACI_A, "sayac", 10000, false)
        .await
        .expect_err("kapsam disi sepette kullanilamamali");
    apply_campaign(&mut conn, KIRACI_A, "yok", 10000, false)
        .await
        .expect_err("bilinmeyen kupon");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "sayac", 10000, true)
        .await
        .expect("kapsam icinde kullanilir");
    assert_eq!(
        sonuc.usage_count, 2,
        "yalnizca kabul edilen iki kullanim sayaci ilerletmeli"
    );

    let istatistik = campaign_stats(&mut conn, KIRACI_A)
        .await
        .expect("istatistik");
    assert_eq!(istatistik.total_usage, 2);
}

#[tokio::test]
async fn ayni_kod_farkli_kiracilarda_kendi_kuralini_uygular() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("A", r#"{"discount_percent":10}"#, Some("ortak")),
    )
    .await
    .expect("A kampanyasi");
    save_campaign(
        &mut conn,
        KIRACI_B,
        "usr_sahip_b",
        kampanya_girdisi("B", r#"{"discount_percent":30}"#, Some("ortak")),
    )
    .await
    .expect("B kampanyasi");

    let a = apply_campaign(&mut conn, KIRACI_A, "ortak", 10000, false)
        .await
        .expect("A kuponu");
    let b = apply_campaign(&mut conn, KIRACI_B, "ortak", 10000, false)
        .await
        .expect("B kuponu");
    assert_eq!(a.discount_cents, 1000, "A kendi kuralini uygulamali");
    assert_eq!(b.discount_cents, 3000, "B kendi kuralini uygulamali");
}

#[tokio::test]
async fn kupon_baska_kiracinin_kampanyasina_erisemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("A", r#"{"discount_percent":50}"#, Some("sirlik")),
    )
    .await
    .expect("A kampanyasi");

    let hata = apply_campaign(&mut conn, KIRACI_B, "sirlik", 10000, false)
        .await
        .expect_err("B, A'nin kuponunu kullanamamali");
    assert!(hata.starts_with("KUPON_GECERSIZ"), "{hata}");

    let a_istatistik = campaign_stats(&mut conn, KIRACI_A)
        .await
        .expect("A istatistigi");
    assert_eq!(
        a_istatistik.total_usage, 0,
        "basarisiz kullanim A sayacini artirmamali"
    );
}

#[tokio::test]
async fn sablon_tek_sinif_campaign_olarak_aktarilabilir() {
    let pool = test_pool().await;
    crate::db::seed_campaign_templates(&pool)
        .await
        .expect("sablonlar tohumlanmali");
    let mut conn = conn_of(&pool).await;

    let sablonlar = list_campaign_templates(&mut conn)
        .await
        .expect("sablonlar okunmali");
    let (_, ad, kural_json) = &sablonlar[0];

    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi(ad, kural_json, Some("sablon")),
    )
    .await
    .expect("sablon kampanyaya cevrilebilmeli");

    let sonuc = apply_campaign(&mut conn, KIRACI_A, "sablon", 50000, false)
        .await
        .expect("sablondan tureyen kupon calismali");
    assert!(sonuc.discount_cents > 0, "sablon indirim uretmeli");
    assert_eq!(sonuc.campaign_id, kampanya.id);
}
