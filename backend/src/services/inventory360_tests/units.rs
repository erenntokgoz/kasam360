//! Faz 12 · Birim çevrimi testleri.
//!
//! Kapsam: çevrim yolunun bulunması, komşu adımlarla zincirlenmesi, ters yönün
//! ayrı kayıtla açılması ve çapraz kiracı reddi.
//!
//! Reçete maliyeti testleri `recipes.rs` içindedir; iki dosya birlikte 500
//! satır sınırının altında kalır.

use super::support::*;
use crate::services::inventory360::units::*;

const KIRACI_A: &str = "tnt_a";
const KIRACI_B: &str = "tnt_b";
/// Tanımı olmayan üçüncü işletme: çevrim yolunun görünmezliği, tanımın hiç
/// bulunmadığı işletmede en açık hâliyle anlaşılır.
const KIRACI_C: &str = "tnt_c";
const AKTOR: &str = "usr_1";

/// Çevrim tanımı kurar. Konu oranın değil, oranın hangi yönde yazıldığıdır.
fn cevrim(from: &str, to: &str, factor: f64, cift_yonlu: bool) -> UnitConversionInput {
    UnitConversionInput {
        from_unit: from.into(),
        to_unit: to.into(),
        factor,
        is_bidirectional: cift_yonlu,
        notes: None,
    }
}


#[tokio::test]
async fn birim_cevrim_yolu_bulunmazsa_hata_verir_miktar_degismez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    // Aynı birim meşru bir sorudur: dönüşüm yapılmaz, miktar da bozulmaz.
    let ayni = convert_quantity(&mut conn, KIRACI_A, "KG", "kg", 5.0).await.unwrap();
    assert!((ayni - 5.0).abs() < f64::EPSILON, "aynı birimde miktar bozulmamalı");
    let sonuc = convert_quantity(&mut conn, KIRACI_A, "kg", "adet", 5.0).await;
    assert!(
        matches!(sonuc, Err(ref hata) if !hata.trim().is_empty()),
        "yol yokken `Ok(5.0)` (sessiz geçiş) ve `Ok(0.0)` (sessiz sıfır) kabul edilemez"
    );
    assert!(
        list_unit_conversions(&mut conn, KIRACI_A).await.unwrap().is_empty(),
        "başarısız çevrim sahte tanım satırı bırakmamalı"
    );
    // Yanlış negatif yok: yol tanımlandığında aynı çağrı karşılığını vermeli.
    upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("kg", "adet", 4.0, false))
        .await
        .unwrap();
    let donusen = convert_quantity(&mut conn, KIRACI_A, "kg", "adet", 5.0).await.unwrap();
    assert!((donusen - 20.0).abs() < 1e-9, "yol varsa çevrim uygulanmalı");
}

#[tokio::test]
async fn birim_cevrim_komşu_adimlarla_zincirlenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("kg", "g", 1000.0, false))
        .await
        .unwrap();
    upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("g", "mg", 1000.0, false))
        .await
        .unwrap();
    let zincir = convert_quantity(&mut conn, KIRACI_A, "kg", "mg", 2.0).await.unwrap();
    assert!((zincir - 2_000_000.0).abs() < 1e-6, "iki adım 2 kg = 2.000.000 mg");
    let tek_adim = convert_quantity(&mut conn, KIRACI_A, "g", "mg", 3.0).await.unwrap();
    assert!((tek_adim - 3000.0).abs() < 1e-9, "tek adım da doğru çalışmalı");
    // Zincirleme ters yönü kendiliğinden yaratmaz: tanımsız yön hataya düşmeye
    // devam eder, yoksa stok ile tüketim sessizce ters yönde karşılaştırılır.
    let ters = convert_quantity(&mut conn, KIRACI_A, "mg", "kg", 2_000_000.0).await;
    assert!(matches!(ters, Err(_)), "tek yönlü tanımdan ters yol türemez");
    assert_eq!(
        list_unit_conversions(&mut conn, KIRACI_A).await.unwrap().len(),
        2,
        "zincirleme sırasında ters satırlar yazılmamalı"
    );
}

#[tokio::test]
async fn ters_yon_ayri_kayit_girilmesi_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let ilk = upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("kg", "g", 1000.0, true))
        .await
        .unwrap();
    assert!(ilk.is_bidirectional, "tanım iki yönlü olmalı");
    let reddedilen =
        upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("g", "kg", 0.001, false)).await;
    assert!(
        matches!(reddedilen, Err(ref hata) if hata.contains("iki yönlü")),
        "ters yön ayrı kayıtla açılamaz: iki oran tutarsız maliyet üretir"
    );
    assert_eq!(
        list_unit_conversions(&mut conn, KIRACI_A).await.unwrap().len(),
        1,
        "reddedilen ters tanım satır olarak yazılmamalı"
    );
    // Otomatik ters yön yine de geçerli: oranın tek doğruluk kaynağı kalmalı.
    let geri = convert_quantity(&mut conn, KIRACI_A, "g", "kg", 2000.0).await.unwrap();
    assert!((geri - 2.0).abs() < 1e-9, "ters yol 1/1000 oranıyla çalışmalı");
}

#[tokio::test]
async fn baska_kiracinin_cevrimi_kullanilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    upsert_unit_conversion(&mut conn, KIRACI_A, AKTOR, cevrim("kg", "g", 1000.0, false))
        .await
        .unwrap();
    let b_tanim =
        upsert_unit_conversion(&mut conn, KIRACI_B, AKTOR, cevrim("kg", "g", 100.0, false))
            .await
            .unwrap();
    // Tanımı olmayan işletme A'nın tanımını da göremeli: çevrim yolu işletmeye
    // özeldir, paylaşılan bir sözlük değildir.
    let izinsiz = convert_quantity(&mut conn, KIRACI_C, "kg", "g", 2.0).await;
    assert!(matches!(izinsiz, Err(_)), "başkasının çevrimi kullanılamaz");
    // Aynı işletme çifti iki işletmede iki farklı oran: hangisinin uygulandığı
    // ancak kiracı filtresiyle ayırt edilebilir.
    let a_sonuc = convert_quantity(&mut conn, KIRACI_A, "kg", "g", 2.0).await.unwrap();
    let b_sonuc = convert_quantity(&mut conn, KIRACI_B, "kg", "g", 2.0).await.unwrap();
    assert!((a_sonuc - 2000.0).abs() < 1e-9, "A kendi oranını kullanmalı");
    assert!((b_sonuc - 200.0).abs() < 1e-9, "B kendi oranını kullanmalı");
    // Silme de kiracıya bağlıdır: A, B'nin kaydını silemez.
    let ele_gecirme = delete_unit_conversion(&mut conn, KIRACI_A, &b_tanim.id).await;
    assert!(
        matches!(ele_gecirme, Err(ref hata) if hata.starts_with("NOT_FOUND")),
        "başka işletmenin çevrimi silinemez"
    );
    let b_kalan = convert_quantity(&mut conn, KIRACI_B, "kg", "g", 2.0).await.unwrap();
    assert!((b_kalan - 200.0).abs() < 1e-9, "B'nin tanımı durmalı");
    // B kendi kaydını sildiğinde A'nın tanımı etkilenmez.
    delete_unit_conversion(&mut conn, KIRACI_B, &b_tanim.id).await.unwrap();
    let b_sonrası = convert_quantity(&mut conn, KIRACI_B, "kg", "g", 2.0).await;
    assert!(matches!(b_sonrası, Err(_)), "silinince B yine yolsuz kalmalı");
    let a_sonrası = convert_quantity(&mut conn, KIRACI_A, "kg", "g", 2.0).await.unwrap();
    assert!((a_sonrası - 2000.0).abs() < 1e-9, "A'nın tanımı silinmemeli");
}

