//! Para çıkışı kapıları (D3).
//!
//! Neden ayrı dosya ve neden saf yordamlar: `cash_out` ve `close_day` Tauri
//! `State` taşıyan komutlardır, bu yüzden doğrudan test edilemezler. Kapı
//! kuralları burada `&str`/`i64` üzerinde yazılır; komutlar yalnız bunları
//! çağırır. Böylece "kasa çıkışı ne zaman onay ister" sorusunun tek ve test
//! edilmiş cevabı vardır.
//!
//! Kural: eşik **aşılınca** onay gerekir (`>=`), altında gerekmez. Eşiğin
//! kendisi işlem tutarına eşitse de onay istenir — eşik "bu tutarı onaylayın"
//! demektir, "bu tutarı onaylamayın" değil.

/// Nakit hareketi tutarı geçerli mi?
///
/// Neden sıfır da reddediliyor: sıfır tutarlı hareket ne para çıkarır ne
/// bir şey kaydeder; yalnızca deftere gürültü ekler ve "bu hareket neden
/// var?" sorusunu doğurur.
pub fn nakit_tutar_gecerli_mi(amount_cents: i64) -> Result<(), String> {
    if amount_cents <= 0 {
        return Err("VALIDATION: Nakit hareketi tutarı sıfırdan büyük olmalıdır.".to_string());
    }
    Ok(())
}

/// Gerekçe zorunlu mu?
///
/// Kasa çıkışı tek taraflı para hareketidir: kasadan çıkan parayı neye
/// harcadığınızı kimse göremez. Gerekçesiz hareket, sahibin kasa çıkışı
/// ile izi sürmüyorsa arasındaki farkı açıklamaktan çıkar.
pub fn gerekce_gecerli_mi(reason: &str) -> Result<(), String> {
    if reason.trim().is_empty() {
        return Err("VALIDATION: Kasa çıkışı için gerekçe zorunludur.".to_string());
    }
    Ok(())
}

/// Vardiya bu hareketi kabul eder mi?
///
/// `None` = vardiya bulunamadı (ya da başka kiracının vardiyası). Ayrı mesaj
/// döner, çünkü "vardiya yok" demek kiracının varlığını sızdırır.
pub fn vardiya_kabul_eder_mi(durum: Option<&str>) -> Result<(), String> {
    let Some(durum) = durum else {
        return Err("NOT_FOUND: Vardiya bulunamadı.".to_string());
    };
    if durum != "OPEN" {
        return Err("VALIDATION: Kapalı vardiyaya kasa çıkışı yapılamaz.".to_string());
    }
    Ok(())
}

/// Bu tutar için onay jetonu gerekli mi?
pub fn onay_gerekli_mi(amount_cents: i64, esik_cents: i64) -> bool {
    amount_cents >= esik_cents
}

/// Jetondan onay metni üretir; eksik/boş jeton hata döner (fail-closed).
pub fn onay_jetonunu_zorunlu_kil(jeton: Option<&str>) -> Result<&str, String> {
    jeton
        .map(str::trim)
        .filter(|deger| !deger.is_empty())
        .ok_or_else(|| crate::approval_service::error::TOKEN_REQUIRED.to_string())
}

/// Gün sonu bu ciro için onay ister mi?
///
/// Eşik günün **cirosudur**, kasa bakiyesi değil. Ciro eşiği aşan gün, kayıt
/// altına alınması gereken gündür.
pub fn gun_sonu_onay_gerekli_mi(gunluk_ciro_cents: i64, esik_cents: i64) -> bool {
    gunluk_ciro_cents >= esik_cents
}

/// Sayım girilmemiş vardiyada kapanış farkı ne olmalı?
///
/// Dönüş: `(actual_amount_cents, difference_cents)`. Sayım yoksa fark
/// `None` yazılır — **sıfır değil**. Sıfır yazmak "kasayı saydım, tutuyor"
/// izlenimi verir ve kasa açığı hatasız görünür (AGENTS.md §3.4 mantığı).
pub fn kapanis_farki(
    expected_cents: i64,
    actual_opt: Option<i64>,
) -> (i64, Option<i64>) {
    match actual_opt {
        Some(actual) => (actual, Some(actual - expected_cents)),
        None => (expected_cents, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nakit_tutari_sifir_ve_negatif_reddedilir() {
        assert!(nakit_tutar_gecerli_mi(100).is_ok());
        assert!(nakit_tutar_gecerli_mi(1).is_ok());
        assert!(nakit_tutar_gecerli_mi(0).is_err());
        assert!(nakit_tutar_gecerli_mi(-1).is_err());
        // Negatif tutar `IN` gibi toplamlara ters yönde işler.
        assert!(nakit_tutar_gecerli_mi(-100_000).is_err());
    }

    #[test]
    fn gerekce_bosluk_sayilir() {
        assert!(gerekce_gecerli_mi("Personel avansı").is_ok());
        assert!(gerekce_gecerli_mi("").is_err());
        assert!(gerekce_gecerli_mi("   ").is_err());
        assert!(gerekce_gecerli_mi("\t\n").is_err());
    }

    #[test]
    fn vardiya_yalnizca_acikken_hareket_kabul_edir() {
        assert!(vardiya_kabul_eder_mi(Some("OPEN")).is_ok());
        assert!(vardiya_kabul_eder_mi(Some("CLOSED")).is_err());
        assert!(vardiya_kabul_eder_mi(None).is_err());
    }

    #[test]
    fn vardiya_bulunamadi_ayri_mesaj_dondurur() {
        // "Vardiya bulunamadı" ile "Kapalı vardiya" ayrımı kiracının varlığını
        // sızdırır; ikisi de reddediyor ama mesajlar farklı.
        assert_eq!(vardiya_kabul_eder_mi(None).unwrap_err(), "NOT_FOUND: Vardiya bulunamadı.");
        assert!(vardiya_kabul_eder_mi(Some("CLOSED")).unwrap_err().starts_with("VALIDATION"));
    }

    #[test]
    fn esik_tam_tutarda_ve_ustunde_onay_ister() {
        let esik = 50_000;
        assert!(!onay_gerekli_mi(esik - 1, esik), "esik altinda onay gerekmez");
        assert!(onay_gerekli_mi(esik, esik), "esik tam tutarda onay gerekir");
        assert!(onay_gerekli_mi(esik + 1, esik), "esik ustunde onay gerekir");
    }

    #[test]
    fn gun_sonu_ciro_esigini_kullanir() {
        let esik = 50_000;
        assert!(!gun_sonu_onay_gerekli_mi(0, esik));
        assert!(!gun_sonu_onay_gerekli_mi(esik - 1, esik));
        assert!(gun_sonu_onay_gerekli_mi(esik, esik));
        assert!(gun_sonu_onay_gerekli_mi(500_000, esik));
    }

    #[test]
    fn eksik_jeton_hata_dondurur() {
        assert!(onay_jetonunu_zorunlu_kil(None).is_err());
        assert!(onay_jetonunu_zorunlu_kil(Some("")).is_err());
        assert!(onay_jetonunu_zorunlu_kil(Some("   ")).is_err());
        assert_eq!(onay_jetonunu_zorunlu_kil(Some(" abc ")).expect("gecerli"), "abc");
    }

    #[test]
    fn sayim_varken_fark_hesaplanir() {
        let (actual, diff) = kapanis_farki(10_000, Some(9_500));
        assert_eq!(actual, 9_500);
        assert_eq!(diff, Some(-500), "kasada 5 TL eksik olmali");
    }

    #[test]
    fn sayim_yokken_fark_sifir_degil_bilinmiyor() {
        let (actual, diff) = kapanis_farki(10_000, None);
        assert_eq!(actual, 10_000);
        // Kritik: `Some(0)` degil `None`. Sifir yazmak kasayi saymis gibi
        // gosterir ve hata bilgisi kaybolur.
        assert_eq!(diff, None, "sayim yoksa fark bilinmiyor, sifir degil");
    }
}