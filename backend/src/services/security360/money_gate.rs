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
///
/// `esik_cents` `None` ise kiracı bu yüzeye eşik tanımlamamıştır ve onay
/// kapalıdır (D3: yeni yüzeyler mevcut davranışla başlar).
pub fn onay_gerekli_mi(amount_cents: i64, esik_cents: Option<i64>) -> bool {
    esik_cents.is_some_and(|esik| amount_cents >= esik)
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
pub fn gun_sonu_onay_gerekli_mi(gunluk_ciro_cents: i64, esik_cents: Option<i64>) -> bool {
    esik_cents.is_some_and(|esik| gunluk_ciro_cents >= esik)
}

/// Gün sonu onayının bağlandığı kaynak kimliği.
///
/// Neden sabit: gün sonu tek ve günlük bir işlemdir; onaylayan "bugünün
/// kapanışı" diyebilir. Tarih eklenirse aynı gün için ikinci bir gün sonu
/// çağrısı onaysız kalırdı.
pub const GUN_SONU_KAYNAK: &str = "DAILY_CLOSING";

/// Kasa çıkışı onayının bağlandığı kaynak kimliği.
///
/// Neden deterministik: onay jetonu işlem **öncesi** üretilir. Hareket `id`si
/// komutun içinde `Uuid::new_v4()` ile üretildiği için onaylayan kişi bu
/// kimliği önceden bilemez; rastgele kimliğe bağlanan onay hiçbir zaman tutmaz
/// ve eşik kapısı kullanılamaz olur. Vardiya + tutar ikilisi onaylayanın
/// bilebileceği, jetonun zaten ayrı ayrı bağladığı değerlerdir.
pub fn kasa_cikis_kaynagi(vardiya_id: &str, tutar_cents: i64) -> String {
    format!("CASH_OUT:{}:{}", vardiya_id.trim(), tutar_cents)
}

/// Sayım girilmemiş vardiyada kapanış farkı ne olmalı?
///
/// Dönüş: `(actual_amount_cents, difference_cents)`. Sayım yoksa fark
/// `None` yazılır — **sıfır değil**. Sıfır yazmak "kasayı saydım, tutuyor"
/// izlenimi verir ve kasa açığı hatasız görünür (AGENTS.md §3.4 mantığı).
pub fn kapanis_farki(expected_cents: i64, actual_opt: Option<i64>) -> (i64, Option<i64>) {
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
        assert_eq!(
            vardiya_kabul_eder_mi(None).unwrap_err(),
            "NOT_FOUND: Vardiya bulunamadı."
        );
        assert!(vardiya_kabul_eder_mi(Some("CLOSED"))
            .unwrap_err()
            .starts_with("VALIDATION"));
    }

    #[test]
    fn esik_tam_tutarda_ve_ustunde_onay_ister() {
        let esik = Some(50_000);
        assert!(!onay_gerekli_mi(49_999, esik), "esik altinda onay gerekmez");
        assert!(
            onay_gerekli_mi(50_000, esik),
            "esik tam tutarda onay gerekir"
        );
        assert!(onay_gerekli_mi(50_001, esik), "esik ustunde onay gerekir");
    }

    #[test]
    fn esik_tanimli_degilse_onay_gerekmez() {
        // D3: yeni yüzeyler eşik tanımlanana kadar mevcut davranışta kalır.
        // `None` yanlışlıkla 0 sanılırsa her işlem onay ister ve kasa durur.
        assert!(!onay_gerekli_mi(1_000_000, None));
        assert!(!gun_sonu_onay_gerekli_mi(1_000_000, None));
        assert!(!onay_gerekli_mi(-5, None));
    }

    #[test]
    fn gun_sonu_ciro_esigini_kullanir() {
        let esik = Some(50_000);
        assert!(!gun_sonu_onay_gerekli_mi(0, esik));
        assert!(!gun_sonu_onay_gerekli_mi(49_999, esik));
        assert!(gun_sonu_onay_gerekli_mi(50_000, esik));
        assert!(gun_sonu_onay_gerekli_mi(500_000, esik));
    }

    #[test]
    fn kasa_cikis_kaynagi_onceden_tahmin_edilebilir() {
        // Onaylayan jeton isterken bu kimliği kendisi kurabilmeli: kaynak
        // vardiya ve tutardan türetilir, komutun içinde üretilen rastgele
        // hareket kimliğinden değil.
        let kaynak = kasa_cikis_kaynagi("shf_001", 75_000);
        assert_eq!(kaynak, "CASH_OUT:shf_001:75000");
        assert_eq!(
            kasa_cikis_kaynagi(" shf_001 ", 75_000),
            kaynak,
            "kenar bosluogu onemsiz"
        );
        // Farkli vardiya veya farkli tutar farkli kaynak: jeton tasinamaz.
        assert_ne!(kasa_cikis_kaynagi("shf_002", 75_000), kaynak);
        assert_ne!(kasa_cikis_kaynagi("shf_001", 75_001), kaynak);
        assert_eq!(GUN_SONU_KAYNAK, "DAILY_CLOSING");
    }

    #[test]
    fn eksik_jeton_hata_dondurur() {
        assert!(onay_jetonunu_zorunlu_kil(None).is_err());
        assert!(onay_jetonunu_zorunlu_kil(Some("")).is_err());
        assert!(onay_jetonunu_zorunlu_kil(Some("   ")).is_err());
        assert_eq!(
            onay_jetonunu_zorunlu_kil(Some(" abc ")).expect("gecerli"),
            "abc"
        );
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
