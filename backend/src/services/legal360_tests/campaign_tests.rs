//! Kampanya kaydı ve kural çözümü testleri.
//!
//! Kuponun **uygulanması** ayrı dosyada (`coupon_tests.rs`): kupon testleri
//! kasada geçen senaryoyu taklit eder ve kendi dosyasında büyür. Buradaki
//! testler kampanyanın tanımını ve kuralın çözümünü sorar.

use super::support::{conn_of, kampanya_girdisi, test_pool, KIRACI_A, KIRACI_B};
use crate::services::legal360::campaigns::apply::kural_indirimi;
use crate::services::legal360::campaigns::{
    campaign_stats, list_campaign_templates, list_campaigns, parse_campaign_rule, save_campaign,
    CampaignInput, CampaignRule,
};

#[tokio::test]
async fn kampanya_kaydedilir_ve_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Kahvaltı", r#"{"discount_percent":10}"#, Some("kahvalti10")),
    )
    .await
    .expect("kampanya kaydedilmeli");

    assert!(kampanya.id.starts_with("cmp_"), "{}", kampanya.id);
    assert_eq!(kampanya.rule.discount_percent, 10);
    assert_eq!(kampanya.coupon_code.as_deref(), Some("KAHVALTI10"));

    let liste = list_campaigns(&mut conn, KIRACI_A, false)
        .await
        .expect("liste okunmali");
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].name, "Kahvaltı");
}

#[tokio::test]
async fn kupon_kodu_buyuk_harfle_saklanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // Küçük harfle girilen kod büyük harfle saklanır: kasa `KAHVALTI10`
    // yazar, müşteri `kahvalti10`. Bu yüzden arama da büyük harfe çevrilir
    // (uygulama `coupon_tests.rs` içinde sınanır).
    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Kahvaltı", r#"{"discount_percent":10}"#, Some("kahvalti10")),
    )
    .await
    .expect("kampanya");
    assert_eq!(kampanya.coupon_code.as_deref(), Some("KAHVALTI10"));
}

#[tokio::test]
async fn kural_zorunludur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let hata = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        CampaignInput {
            id: None,
            name: "Kuralsız".to_string(),
            rule_json: None,
            rule: None,
            coupon_code: None,
            max_usage: None,
            valid_from: None,
            valid_to: None,
            is_active: None,
        },
    )
    .await
    .expect_err("kuralsiz kampanya reddedilmeli");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn gecersiz_kural_json_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // `bilinmeyen` alan `deny_unknown_fields` ile reddedilir: yazım hatası
    // sessizce etkisiz bir kurala dönüşmesin diye.
    for bozuk in [
        "{bozuk",
        r#"{"discount_percent":"cok"}"#,
        r#"{"bilinmeyen":1}"#,
    ] {
        let hata = save_campaign(
            &mut conn,
            KIRACI_A,
            "usr_sahip",
            kampanya_girdisi("Bozuk", bozuk, None),
        )
        .await
        .unwrap_err();
        assert!(
            hata.starts_with("VALIDATION"),
            "bicimsiz/bilinmeyen alan sessizce gecmemeli ({bozuk}): {hata}"
        );
    }
}

#[tokio::test]
async fn kural_yapisal_girdi_ile_de_verilebilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        CampaignInput {
            id: None,
            name: "Yapısal".to_string(),
            rule_json: None,
            rule: Some(CampaignRule {
                discount_percent: 20,
                min_total_cents: Some(10000),
                ..CampaignRule::default()
            }),
            coupon_code: Some("yapisal".to_string()),
            max_usage: None,
            valid_from: None,
            valid_to: None,
            is_active: None,
        },
    )
    .await
    .expect("yapisal kural kabul edilmeli");
    assert_eq!(kampanya.rule.min_total_cents, Some(10000));
}

#[tokio::test]
async fn gecersiz_kural_sinirlari_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // %100 indirim zarar yazar.
    for kural_json in [
        r#"{"discount_percent":100}"#,
        r#"{"discount_percent":-5}"#,
        r#"{"min_total_cents":-1}"#,
        r#"{"start_time":"25:00"}"#,
    ] {
        let hata = save_campaign(
            &mut conn,
            KIRACI_A,
            "usr_sahip",
            kampanya_girdisi("Sınırsız", kural_json, None),
        )
        .await
        .unwrap_err();
        assert!(hata.starts_with("VALIDATION"), "{kural_json}: {hata}");
    }
}

#[tokio::test]
async fn tarih_penceresi_ters_olamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let mut ters = kampanya_girdisi("Ters", r#"{"discount_percent":5}"#, None);
    ters.valid_from = Some("2026-12-31".to_string());
    ters.valid_to = Some("2026-01-01".to_string());
    let hata = save_campaign(&mut conn, KIRACI_A, "usr_sahip", ters)
        .await
        .expect_err("bitis baslangictan once olamaz");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn ayni_kupon_kodu_iki_kampanyada_kullanilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("Birinci", r#"{"discount_percent":10}"#, Some("ayni")),
    )
    .await
    .expect("birinci kampanya");

    let hata = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("İkinci", r#"{"discount_percent":20}"#, Some("ayni")),
    )
    .await
    .expect_err("ayni kupon kodu iki kampanyada kullanilamamali");
    assert!(hata.starts_with("VALIDATION"), "{hata}");
}

#[tokio::test]
async fn ayni_kod_farkli_kiracilarda_kullanilabilir() {
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
    .expect("B kampanyasi ayni kodla acilabilmeli");
}

#[tokio::test]
async fn kiracilar_arasinda_kampanya_listesi_karismaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("A", r#"{"discount_percent":10}"#, Some("a10")),
    )
    .await
    .expect("A kampanyasi");

    let b_liste = list_campaigns(&mut conn, KIRACI_B, false)
        .await
        .expect("B listesi");
    assert!(b_liste.is_empty(), "B isletmesi A kampanyasini gormemeli");

    let b_istatistik = campaign_stats(&mut conn, KIRACI_B)
        .await
        .expect("B istatistigi");
    assert_eq!(b_istatistik.total_campaigns, 0, "B kampanya saymamali");
}

#[tokio::test]
async fn kiraci_baska_kiracinin_kampanyasini_guncelleyemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let kampanya = save_campaign(
        &mut conn,
        KIRACI_A,
        "usr_sahip",
        kampanya_girdisi("A", r#"{"discount_percent":10}"#, Some("a10")),
    )
    .await
    .expect("A kampanyasi");

    // Kural **geçerli** olmalı: aksi halde doğrulama kiracı denetiminden önce
    // reddedip test yanlış sebebi kanıtlardı. Tek geçerli sebep kalmalı: sahiplik.
    let mut saldirgan = kampanya_girdisi("Çalınan", r#"{"discount_percent":50}"#, Some("a10"));
    saldirgan.id = Some(kampanya.id.clone());
    let hata = save_campaign(&mut conn, KIRACI_B, "usr_sahip_b", saldirgan)
        .await
        .expect_err("B, A kampanyasini guncelleyememeli");
    assert!(hata.starts_with("NOT_FOUND"), "{hata}");

    let a_liste = list_campaigns(&mut conn, KIRACI_A, false)
        .await
        .expect("A listesi");
    assert_eq!(
        a_liste[0].rule.discount_percent, 10,
        "A kampanyasi bozulmamali"
    );
}

#[tokio::test]
async fn sistem_sablonlari_hazir_ve_ortak_katalogdur() {
    let pool = test_pool().await;
    // Tohumlama havuz üzerinden yapılır: bağlantı `max_connections(1)` ile
    // ayrıldığında havuzda boş bağlantı kalmaz.
    crate::db::seed_campaign_templates(&pool)
        .await
        .expect("sablonlar tohumlanmali");
    let mut conn = conn_of(&pool).await;

    let sablonlar = list_campaign_templates(&mut conn)
        .await
        .expect("sablonlar okunmali");
    assert_eq!(sablonlar.len(), 10, "on hazir sablon beklenir");

    // Her şablon kuralı gerçekten çözülebilir ve indirim üretmeli.
    for (id, ad, kural_json) in &sablonlar {
        let kural = parse_campaign_rule(kural_json)
            .unwrap_or_else(|hata| panic!("{id} ({ad}) çözülemedi: {hata}"));
        assert!(
            kural.discount_percent > 0,
            "{id} ({ad}) indirim üretmiyor: {kural:?}"
        );
    }
}

#[tokio::test]
async fn indirim_sepeti_asan_kismi_kirpar() {
    let kural = CampaignRule {
        discount_percent: 50,
        fixed_discount_cents: Some(100000),
        ..CampaignRule::default()
    };
    // Toplam indirim sepeti aşamaz: kasa tahsilat yerine para ödememeli.
    assert_eq!(kural_indirimi(&kural, 1000), 1000);
    assert_eq!(kural_indirimi(&kural, 0), 0);
}

#[tokio::test]
async fn yuzde_indirim_kurus_a_sagi_yuvarlanir() {
    let kural = CampaignRule {
        discount_percent: 10,
        ..CampaignRule::default()
    };
    // 105 kuruşun %10'u 10.5 kuruş; aşağı yuvarlanır ve fark kuruşu
    // müşteriye kalır.
    assert_eq!(kural_indirimi(&kural, 105), 10);
    assert_eq!(kural_indirimi(&kural, 100), 10);
    assert_eq!(kural_indirimi(&kural, 99), 9);
}
