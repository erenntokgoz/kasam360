//! Dinamik kural ve fiyat dondurma testleri.

use sqlx::Row;

use super::super::support::*;
use crate::services::inventory360::pricing::*;

const T: &str = "tnt_1";
const AKTOR: &str = "usr_1";

fn dondurma_girdisi(urun_id: &str, fiyat_kurus: i64) -> PriceFreezeInput {
    PriceFreezeInput {
        product_id: urun_id.to_string(),
        frozen_price_cents: fiyat_kurus,
        reason: Some(" sozlesme fiyati".to_string()),
        valid_from: bugun(),
        valid_to: bugun(),
    }
}

fn toplu_girdisi(urunler: Option<Vec<String>>, yuzde: Option<f64>) -> BulkPriceInput {
    BulkPriceInput {
        category_id: None,
        product_ids: urunler,
        percent: yuzde,
        by_cents: None,
        round_to_tens: Some(false),
    }
}

#[tokio::test]
async fn happy_hour_indirimi_saat_disiinda_uygulanmaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    upsert_pricing_rule(
        &mut conn,
        T,
        AKTOR,
        kural_girdisi("Mutfak Akşamı", 20, "17:00", "20:00"),
    )
    .await
    .expect("kural kaydedilmeli");

    let disinda = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(disinda.source, PriceSource::ProductPrice);
    assert_eq!(disinda.final_price_cents, 4500);
    assert_eq!(disinda.discount_cents, 0);

    let icinde = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("18:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(icinde.source, PriceSource::DynamicRule);
    assert_eq!(icinde.final_price_cents, 3600);
    assert_eq!(icinde.discount_cents, 900);

    // Bitiş saati başlangıç sayılır: 20:00'de pencere kapanmış olmalı.
    let kapali = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("20:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(kapali.source, PriceSource::ProductPrice);
}

#[tokio::test]
async fn gece_yarisi_asan_kural_calisir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    upsert_pricing_rule(
        &mut conn,
        T,
        AKTOR,
        kural_girdisi("Gece", 10, "22:00", "02:00"),
    )
    .await
    .expect("kural kaydedilmeli");

    for (saat, beklenen_kaynak) in [
        ("23:30", PriceSource::DynamicRule),
        ("01:00", PriceSource::DynamicRule),
        ("12:00", PriceSource::ProductPrice),
    ] {
        let sonuc = effective_price(&mut conn, T, "prd_1", Some(sabit_gun(saat)))
            .await
            .expect("fiyat cozulemeli");
        assert_eq!(
            sonuc.source, beklenen_kaynak,
            "saat {saat} icin yanlis kaynak"
        );
    }

    // Saat karşılaştırması metinle yapıldığı için 22:00'i kapsayan akşam kısmı
    // sınırda da eşleşmeli.
    let sinir = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("22:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(sinir.source, PriceSource::DynamicRule);
}

#[tokio::test]
async fn fiyat_dondurma_dinamik_indirimden_gucludur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    upsert_pricing_rule(
        &mut conn,
        T,
        AKTOR,
        kural_girdisi("Mutfak Akşamı", 20, "17:00", "20:00"),
    )
    .await
    .expect("kural kaydedilmeli");
    create_price_freeze(&mut conn, T, AKTOR, dondurma_girdisi("prd_1", 3800))
        .await
        .expect("dondurma acilmali");

    let sonuc = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("18:00")))
        .await
        .expect("fiyat cozulemeli");
    // Dondurma bir taahhüttür: aktif %20 indirim onu delmemeli.
    assert_eq!(sonuc.source, PriceSource::Frozen);
    assert_eq!(sonuc.final_price_cents, 3800);
    assert_eq!(
        sonuc.rule_id, None,
        "dondurma secildiğinde kural uygulanmamali"
    );

    // Süresi dolmuş dondurma tekrar devreye girmemeli.
    let bitmis =
        sqlx::query("UPDATE price_freezes SET valid_from = '2000-01-01', valid_to = '2000-01-02'")
            .execute(&mut conn)
            .await
            .expect("dondurma guncellenmeli");
    assert_eq!(bitmis.rows_affected(), 1);
    let sonraki = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("18:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(sonraki.source, PriceSource::DynamicRule);
    assert_eq!(sonraki.final_price_cents, 3600);
}

#[tokio::test]
async fn zam_oldugu_icere_kayit_dondurulmaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let hata = create_price_freeze(&mut conn, T, AKTOR, dondurma_girdisi("prd_1", 9900))
        .await
        .expect_err("zam iceren dondurma reddedilmeli");
    assert!(hata.contains("yüksek"), "neden belirtilmeli: {hata}");

    let negatif = create_price_freeze(&mut conn, T, AKTOR, dondurma_girdisi("prd_1", -100))
        .await
        .expect_err("negatif dondurma reddedilmeli");
    assert!(negatif.contains("negatif"), "neden belirtilmeli: {negatif}");

    // Ters tarih aralığı da taahhüt değil, hatalı kayıttır.
    let mut giris = dondurma_girdisi("prd_1", 4000);
    giris.valid_from = "2026-12-31".to_string();
    giris.valid_to = "2026-01-01".to_string();
    let ters = create_price_freeze(&mut conn, T, AKTOR, giris)
        .await
        .expect_err("ters tarih araligi reddedilmeli");
    assert!(ters.contains("önce"), "neden belirtilmeli: {ters}");

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM price_freezes")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "reddedilen kayit yazilmamali");
}

#[tokio::test]
async fn toplu_zam_dondurulmus_urunde_uygulanmaz_ama_atlanmaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    urun_ekle(&mut conn, T, "prd_2", "Latte", 3200).await;
    create_price_freeze(&mut conn, T, AKTOR, dondurma_girdisi("prd_1", 4000))
        .await
        .expect("dondurma acilmali");

    let sonuc = bulk_update_prices(
        &mut conn,
        T,
        toplu_girdisi(
            Some(vec!["prd_1".to_string(), "prd_2".to_string()]),
            Some(10.0),
        ),
    )
    .await
    .expect("toplu zam calismali");

    assert_eq!(sonuc.changed.len(), 1);
    assert_eq!(sonuc.changed[0].product_id, "prd_2");
    assert_eq!(sonuc.changed[0].new_price_cents, 3520);

    // Dondurma sessizce yutulmaz: raporda görünür ve fiyatı değişmez.
    assert_eq!(sonuc.skipped.len(), 1);
    assert_eq!(sonuc.skipped[0].product_id, "prd_1");
    assert_eq!(
        sonuc.skipped[0].new_price_cents, 4500,
        "dondurulmus urun degismemeli"
    );
    assert!(
        sonuc.skipped[0].skipped.is_some(),
        "atlama nedeni bildirilmeli"
    );

    let satir = sqlx::query("SELECT price_cents FROM products WHERE id = 'prd_1'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    let fiyat: i64 = satir.try_get("price_cents").expect("fiyat okunmali");
    assert_eq!(fiyat, 4500);
}
