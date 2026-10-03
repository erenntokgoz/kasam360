//! Faz 12 · Dinamik kural, fiyat dondurma, toplu zam ve 86'd testleri.
//!
//! Kapsam: dinamik kural saat kapısı, gece yarısını aşan kural, dondurmanın
//! indirimden üstünlüğü, zam içeren kaydın reddi, toplu zamda donmuş ürünün
//! atlanması, negatif fiyat üretilmemesi, hedefsiz toplu çağrının reddi ve
//! 86'd bayrağının fiyat güncellemesiyle karışmaması.
//!
//! Fiyat listesi ve menü penceresi testleri `price_lists_windows.rs` içindedir;
//! iki dosya birlikte 500 satır sınırının altında kalır.

use sqlx::Row;

use super::support::*;
// Girdi tipleri, `PriceSource` ve fonksiyonların tamamı alt modülün kökünde
// dışa açılıyor; ayrı glob gerekmiyor ve kullanılmayan import uyarısı üretiyor.
use crate::services::inventory360::pricing::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";
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
        // Yuvarlama kapatılır: testler ham sonucu doğrulamak istiyor, psikolojik
        // fiyat yuvarlamasının kendisi başka bir karar.
        round_to_tens: Some(false),
    }
}

#[tokio::test]
async fn happy_hour_indirimi_saat_disiinda_uygulanmaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Mutfak Akşamı", 20, "17:00", "20:00"))
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
    upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Gece", 10, "22:00", "02:00"))
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
        assert_eq!(sonuc.source, beklenen_kaynak, "saat {saat} icin yanlis kaynak");
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
    upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Mutfak Akşamı", 20, "17:00", "20:00"))
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
    assert_eq!(sonuc.rule_id, None, "dondurma secildiğinde kural uygulanmamali");

    // Süresi dolmuş dondurma tekrar devreye girmemeli.
    let bitmis = sqlx::query(
        "UPDATE price_freezes SET valid_from = '2000-01-01', valid_to = '2000-01-02'",
    )
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
        toplu_girdisi(Some(vec!["prd_1".to_string(), "prd_2".to_string()]), Some(10.0)),
    )
    .await
    .expect("toplu zam calismali");

    assert_eq!(sonuc.changed.len(), 1);
    assert_eq!(sonuc.changed[0].product_id, "prd_2");
    assert_eq!(sonuc.changed[0].new_price_cents, 3520);

    // Dondurma sessizce yutulmaz: raporda görünür ve fiyatı değişmez.
    assert_eq!(sonuc.skipped.len(), 1);
    assert_eq!(sonuc.skipped[0].product_id, "prd_1");
    assert_eq!(sonuc.skipped[0].new_price_cents, 4500, "dondurulmus urun degismemeli");
    assert!(sonuc.skipped[0].skipped.is_some(), "atlama nedeni bildirilmeli");

    let satir = sqlx::query("SELECT price_cents FROM products WHERE id = 'prd_1'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    let fiyat: i64 = satir.try_get("price_cents").expect("fiyat okunmali");
    assert_eq!(fiyat, 4500);
}

#[tokio::test]
async fn toplu_zam_uretken_negatif_fiyat_uretmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 100).await;

    let sonuc = bulk_update_prices(&mut conn, T, toplu_girdisi(Some(vec!["prd_1".to_string()]), Some(-150.0)))
        .await
        .expect("toplu zam calismali");

    assert!(sonuc.changed.is_empty(), "negatif fiyat uygulanmamali");
    assert_eq!(sonuc.skipped.len(), 1);
    assert!(sonuc.skipped[0].skipped.is_some());

    let satir = sqlx::query("SELECT price_cents FROM products WHERE id = 'prd_1'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    let fiyat: i64 = satir.try_get("price_cents").expect("fiyat okunmali");
    // Sıfıra kırpmak da yanlıştır: ürün bedava satılır. Ne eski ne sıfır.
    assert_eq!(fiyat, 100, "negatif hesap fiyati bozmamali");
    assert_ne!(fiyat, 0);
}

#[tokio::test]
async fn toplu_zam_hedefsiz_cagrilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;

    let hedefsiz = bulk_update_prices(&mut conn, T, toplu_girdisi(None, Some(10.0)))
        .await
        .expect_err("hedefsiz toplu zam reddedilmeli");
    assert!(hedefsiz.contains("zorunlu"), "neden belirtilmeli: {hedefsiz}");

    let degisimsiz = bulk_update_prices(
        &mut conn,
        T,
        BulkPriceInput {
            category_id: None,
            product_ids: Some(vec!["prd_1".to_string()]),
            percent: None,
            by_cents: None,
            round_to_tens: None,
        },
    )
    .await
    .expect_err("yuzdesiz ve kurussuz cagri reddedilmeli");
    assert!(degisimsiz.contains("zorunlu"), "neden belirtilmeli: {degisimsiz}");

    let negatif = bulk_update_prices(
        &mut conn,
        T,
        BulkPriceInput {
            category_id: None,
            product_ids: Some(vec!["prd_1".to_string()]),
            percent: None,
            by_cents: Some(-500),
            round_to_tens: None,
        },
    )
    .await
    .expect_err("negatif kurus reddedilmeli");
    assert!(negatif.contains("negatif"), "neden belirtilmeli: {negatif}");

    let bos = bulk_update_prices(
        &mut conn,
        T,
        BulkPriceInput {
            category_id: None,
            product_ids: Some(Vec::new()),
            percent: Some(10.0),
            by_cents: None,
            round_to_tens: None,
        },
    )
    .await
    .expect_err("bos listede zam reddedilmeli");
    assert!(bos.contains("ürün bulunamadı"), "neden belirtilmeli: {bos}");
}

#[tokio::test]
async fn kurt_alan_indirim_yuzdesi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let sifir = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Sifir", 0, "10:00", "12:00"))
        .await
        .expect_err("sifir indirim reddedilmeli");
    assert!(sifir.contains("1-90"), "neden belirtilmeli: {sifir}");

    let asiri = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Asiri", 91, "10:00", "12:00"))
        .await
        .expect_err("%91 indirim reddedilmeli");
    assert!(asiri.contains("1-90"), "neden belirtilmeli: {asiri}");

    // Kapsam sınırı kabul edilmeli.
    upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Sinir", 90, "10:00", "12:00"))
        .await
        .expect("siniirdaki indirim kabul edilmeli");

    let tur = upsert_pricing_rule(
        &mut conn,
        T,
        AKTOR,
        PricingRuleInput {
            kind: Some("BLACK_FRIDAY".to_string()),
            ..kural_girdisi("Tur", 10, "10:00", "12:00")
        },
    )
    .await
    .expect_err("bilinmeyen kural turu reddedilmeli");
    assert!(tur.contains("geçersiz"), "neden belirtilmeli: {tur}");

    let sifir_bitis = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Bos", 10, "10:00", "10:00"))
        .await
        .expect_err("baslangicla ayni bitis reddedilmeli");
    assert!(sifir_bitis.contains("farklı"), "neden belirtilmeli: {sifir_bitis}");
}

#[tokio::test]
async fn bozuk_saat_bicimi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    let aralik_disi = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Bicim", 10, "25:00", "26:00"))
        .await
        .expect_err("saat 25 reddedilmeli");
    assert!(aralik_disi.contains("aralık dışında"), "neden belirtilmeli: {aralik_disi}");

    let sayi_degil = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Bicim", 10, "aa:bb", "12:00"))
        .await
        .expect_err("sayi olmayan saat reddedilmeli");
    assert!(sayi_degil.contains("okunamadı"), "neden belirtilmeli: {sayi_degil}");

    let eksik_parca = upsert_pricing_rule(&mut conn, T, AKTOR, kural_girdisi("Bicim", 10, "10", "12:00"))
        .await
        .expect_err("saatsiz saat reddedilmeli");
    assert!(eksik_parca.contains("SS:DD"), "neden belirtilmeli: {eksik_parca}");

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dynamic_pricing_rules")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "bozuk saatli kural yazilmamali");
}

#[tokio::test]
async fn atlanan_urun_satis_disi_birakilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    set_product_86d(&mut conn, T, AKTOR, "prd_1", true, Some("bitti".to_string()))
        .await
        .expect("86 verilmeli");

    bulk_update_prices(&mut conn, T, toplu_girdisi(Some(vec!["prd_1".to_string()]), Some(10.0)))
        .await
        .expect("toplu zam calismali");

    // Zam 86 bayrağına dokunmaz: 86 geçicidir, ürün stoğu gelince menüye döner.
    let sonuc = effective_price(&mut conn, T, "prd_1", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert!(sonuc.is_86d, "toplu zam 86 urunu satisa acmamali");
    assert_eq!(sonuc.stockout_reason.as_deref(), Some("bitti"));

    let satir = sqlx::query("SELECT is_active, is_86 FROM products WHERE id = 'prd_1'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    assert_eq!(satir.try_get::<bool, _>("is_active").expect("kolon okunmali"), true);
    assert_eq!(satir.try_get::<bool, _>("is_86").expect("kolon okunmali"), true);

    // Stoğa dönünce 86 kalkmalı, kalıcı menü bayrağına dokunulmamalı.
    set_product_86d(&mut conn, T, AKTOR, "prd_1", false, Some("bitti".to_string()))
        .await
        .expect("86 kaldirilmali");
    let geri = sqlx::query("SELECT is_active, is_86, stockout_reason FROM products WHERE id = 'prd_1'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    assert_eq!(geri.try_get::<bool, _>("is_active").expect("kolon okunmali"), true);
    assert_eq!(geri.try_get::<bool, _>("is_86").expect("kolon okunmali"), false);
    assert_eq!(
        geri.try_get::<Option<String>, _>("stockout_reason").expect("kolon okunmali"),
        None,
        "stok acilisi gerekcesi temizlenmeli"
    );
}

#[tokio::test]
async fn yabanci_isletmenin_urunu_86_yapilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T2, "prd_yabanci", "Kahve", 4500).await;

    let hata = set_product_86d(&mut conn, T, AKTOR, "prd_yabanci", true, None)
        .await
        .expect_err("yabanci urun 86 yapilamamali");
    assert!(hata.contains("NOT_FOUND") || hata.contains("bulunam"), "neden belirtilmeli: {hata}");

    let satir = sqlx::query("SELECT is_86 FROM products WHERE id = 'prd_yabanci'")
        .fetch_one(&mut conn)
        .await
        .expect("urun okunmali");
    assert_eq!(
        satir.try_get::<bool, _>("is_86").expect("kolon okunmali"),
        false,
        "cagri basarisiz olsa da kiraci satiri degismemeli"
    );

    // Kiracının kendi ürünü değişmişse fiyat çözümü yalnız kendi ürününü görür.
    urun_ekle(&mut conn, T, "prd_benim", "Çay", 1500).await;
    let benim = effective_price(&mut conn, T, "prd_benim", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(benim.base_price_cents, 1500);
    let yabanci = effective_price(&mut conn, T2, "prd_yabanci", Some(sabit_gun("12:00")))
        .await
        .expect("fiyat cozulemeli");
    assert_eq!(yabanci.base_price_cents, 4500);
}

