//! Faz 12 · Fiyat listesi ve menü penceresi testleri.
//!
//! Kapsam: fiyat listesinin ürün fiyatını eğmesi, dinamik kuralın listede de
//! üstünlüğü, yabancı kalemin listeye sızamaması, öğle penceresinin üründe
//! görünürlüğü ve ters pencerenin reddi.
//!
//! Bu dosya `pricing.rs` ile birlikte 500 satır sınırının altında kalsın diye
//! ayrıldı; ikisi aynı konuyu (fiyat çözümlemesi) ikişerli kapsar.

use super::support::*;
use crate::services::inventory360::pricing::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";
const AKTOR: &str = "usr_1";
#[tokio::test]
async fn fiyat_listesi_urun_fiyatini_egerse_kullanilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    urun_ekle(&mut conn, T2, "prd_2", "Kahve", 9900).await;

    create_price_list(
        &mut conn,
        T,
        AKTOR,
        PriceListInput {
            id: None,
            name: "Saha".to_string(),
            kind: Some("TOPTAN".to_string()),
            valid_from: None,
            valid_to: None,
            is_active: Some(true),
            items: Some(vec![PriceListItemInput {
                product_id: "prd_1".to_string(),
                price_cents: 3800,
            }]),
        },
    )
    .await
    .expect("fiyat listesi olusmali");

    let liste = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(liste.source, PriceSource::PriceList);
    assert_eq!(liste.final_price_cents, 3800);
    assert_eq!(liste.discount_cents, 700);

    // Aynı ürün adını taşıyan yabancı işletmenin fiyat listesi yoksa ürün
    // fiyatında kalmalı; liste kalemi sızıntı yapmamalı.
    let yabanci = effective_price(&mut conn, T2, "prd_2", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(yabanci.source, PriceSource::ProductPrice);
    assert_eq!(yabanci.final_price_cents, 9900);

    // Dinamik kural, listeden de üstündür ve tabanı ürün fiyatıdır: iki indirim
    // üst üste binmez, kural tek başına uygulanır. Aksi halde %20 kural %5 liste
    // üzerine biner ve kasada görünmeyen bir fiyat oluşur.
    upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Mutfak Akşamı", 20, "17:00", "20:00"))
        .await
        .expect("kural kaydedilmeli");
    let kural = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("18:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(kural.source, PriceSource::DynamicRule);
    assert_eq!(kural.final_price_cents, 3600);

    // Yabancı işletmenin listesine yabancı kalem yazılamaz.
    let sizinti = create_price_list(
        &mut conn,
        T2,
        AKTOR,
        PriceListInput {
            id: None,
            name: "Yabanci".to_string(),
            kind: Some("TOPTAN".to_string()),
            valid_from: None,
            valid_to: None,
            is_active: Some(true),
            items: Some(vec![PriceListItemInput {
                product_id: "prd_1".to_string(),
                price_cents: 100,
            }]),
        },
    )
    .await
    .expect_err("yabanci urun listeye yazilamamali");
    assert!(sizinti.contains("NOT_FOUND") || sizinti.contains("bulunam"), "neden: {sizinti}");

    // Silme de kiraciya bagli.
    let listeler = list_price_lists(&mut conn, T).await.expect("listeler okunmali");
    assert_eq!(listeler.len(), 1);
    let silme = delete_price_list(&mut conn, T2, &listeler[0].id)
        .await
        .expect_err("yabanci liste silinememeli");
    assert!(silme.contains("NOT_FOUND") || silme.contains("bulunam"), "neden: {silme}");
}

#[tokio::test]
async fn ogle_aksam_penceresi_etkin_urunde_gorunur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let pencere = upsert_service_window(
        &mut conn,
        T,
        ServiceWindowInput {
            name: "ogle".to_string(),
            start_time: "11:30".to_string(),
            end_time: "14:00".to_string(),
            is_active: Some(true),
        },
    )
    .await
    .expect("pencere olusmali");
    assert_eq!(pencere.name, "OGLE", "pencere adi buyuk harfe normalize edilmeli");

    set_window_product(&mut conn, T, &pencere.id, "prd_1", true)
        .await
        .expect("urun pencereye eklenmeli");

    let ogle = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(ogle.service_window.as_deref(), Some("OGLE"));

    let aksam = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("20:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(aksam.service_window, None, "pencere disinda kist olmamali");

    // Pencereyi kapatmak görünürlüğü de kaldırmalı.
    upsert_service_window(
        &mut conn,
        T,
        ServiceWindowInput {
            name: "OGLE".to_string(),
            start_time: "11:30".to_string(),
            end_time: "14:00".to_string(),
            is_active: Some(false),
        },
    )
    .await
    .expect("pencere guncellenmeli");
    let kapali = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(kapali.service_window, None);

    let pencereler = list_service_windows(&mut conn, T).await.expect("pencereler okunmali");
    assert_eq!(pencereler.len(), 1, "ayni ad iki pencere olmamali");
    assert_eq!(pencereler[0].id, pencere.id);

    // Yabancı işletmenin ürünü pencereye eklenemez.
    urun_ekle(&mut conn, T2, "prd_yabanci", "Çay", 1500).await;
    let sizinti = set_window_product(&mut conn, T2, &pencere.id, "prd_yabanci", true)
        .await
        .expect_err("yabanci pencere kullanilamamali");
    assert!(sizinti.contains("NOT_FOUND") || sizinti.contains("bulunam"), "neden: {sizinti}");

    // Bitiş başlangıçtan önceyse pencere hiç oluşmamalı.
    let ters = upsert_service_window(
        &mut conn,
        T,
        ServiceWindowInput {
            name: "AKSAM".to_string(),
            start_time: "22:00".to_string(),
            end_time: "20:00".to_string(),
            is_active: Some(true),
        },
    )
    .await
    .expect_err("ters pencere reddedilmeli");
    assert!(ters.contains("sonra"), "neden belirtilmeli: {ters}");
}
