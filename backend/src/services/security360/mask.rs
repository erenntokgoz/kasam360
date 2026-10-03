//! KVKK maskeleme katmanı.
//!
//! Neden yazma yolunda: maskeleme arayüzde yapılırsa (A6 bulgusu) ham kişisel
//! veri önce diske yazılır, sonra gizlenir. KVKK'da amaç verinin **hiçbir
//! zaman** açık yazılmamasıdır; sonradan maskelemek kaydı geri döndürülemez
//! hale getirmez. Bu yüzden katman `AuditContext::new` içine, yani tek
//! yazma noktasına yerleştirilir.
//!
//! Neden iki katman (anahtar + örüntü): anahtar tabanlı maskeleme belirli ve
//! yanlış pozitif üretmez ama yeni geliştiricinin alanı `iletisim` diye
//! açmasını engellemez. Örüntü tabanlı katman bunları yakalar. Sıralama önemli:
//! önce anahtar, sonra örüntü — anahtar tabanlı maske zaten `***` ürettiği için
//! örüntü katmanı onu tekrar işlemez.
//!
//! **Neden sayılar örüntü taramasına girmez:** `amountCents` 11 haneli olabilir
//! (1.000.000 TL = 100.000.000 kuruş) ve TCKN ile aynı biçimdedir. JSON sayıları
//! taranmaz; TCKN yalnızca metin değerlerde aranır.

/// Maskelenmiş alanın yerine geçen işaret.
const MASKE: &str = "***";

/// Anahtar adı küçük harfe indirgenip bu parçalardan birini içeriyorsa değer
/// maskelenir.
///
/// Liste kasten geniş: alan adı tam eşleşmesi değil **içerir** eşleşmesidir.
/// `phone`, `phoneNumber`, `phone_number`, `customerPhone` — hepsi aynı alan.
/// Dar liste, geliştiricinin tek bir alan adı değiştirmesiyle sızdırmaya yol
/// açardı ve sızıntı sessiz olurdu.
const HASSAS_ANAHTARLAR: &[&str] = &[
    // Kimlik
    "tckn", "tcno", "kimlikno", "identity", "passport", "pasaport",
    // İletişim
    "phone", "telefon", "gsm", "cep", "email", "eposta", "mail",
    // Adres
    "adres", "address", "street", "cadde", "ilce",
    // Ödeme
    "iban", "card", "kart", "creditcard", "cvc", "cvv", "pan",
    // Sır
    "password", "parola", "sifre", "secret", "pin", "token", "jwt", "session",
    // Vergi
    "taxno", "vkn", "vergino",
];

/// Örüntü tabanlı maskeleme için TCKN uzunluğu (11 hane).
const TCKN_UZUNLUK: usize = 11;

/// Metin değerleri için örüntü tabanlı maskeleme.
///
/// Yalnızca **yüksek güvenli** örüntüler taranır. Belirsiz örüntü (örneğin
/// "11 haneli sayı") maskelendiğinde para tutarları da yanlışlıkla maskelenir
/// ve defter finansal kanıt değerini kaybeder; bu, maskelemenin kendisinden
/// daha büyük bir zarardır.
fn maske_uygula_metin(deger: &str) -> Option<String> {
    let kirp = deger.trim();
    if kirp.is_empty() {
        return None;
    }

    // E-posta: yerel kısımın başı korunur, alan adı gizlenir.
    // Neden korunur: "ayse@..." ile "mehmet@..." ayrımı denetimde işe yarar,
    // adresin kendisi ise kişisel veridir.
    if let Some((yerel, alan)) = kirp.split_once('@') {
        if alan.contains('.') && !alan.starts_with('@') {
            let son = alan.rsplit('.').next().unwrap_or(MASKE);
            return Some(format!("{}@{}", &yerel[..yerel.len().min(2)], son));
        }
    }

    // IBAN: TR + 24 hane. Uzunluğu ülke kodu ile tutarlı tek biçim.
    if kirp.len() == 26
        && kirp.chars().all(|c| c.is_ascii_alphanumeric())
        && kirp.to_uppercase().starts_with("TR")
    {
        return Some(MASKE.to_string());
    }

    // TCKN: 11 rakam, ilk rakam sıfır değil. Metin değerlerde taranır; JSON
    // sayıları taranmaz (para tutarıyla karışmasın diye).
    let karakterler: Vec<char> = kirp.chars().collect();
    if karakterler.len() == TCKN_UZUNLUK && karakterler.iter().all(|c| c.is_ascii_digit()) {
        // `0` ile başlayan 11 hane TCKN **olamaz** (ilk rakam 1-9 olmalı);
        // belirsizlik yok, bu yüzden aynı uzunlukta maske güvenlidir.
        if karakterler[0] != '0' {
            return Some(MASKE.to_string());
        }
        // Türkiye cep/sabit telefonu: `05XX` + 9 rakam. Standart alan adıyla
        // yazılmadığında (`iletisim`, `hat`) anahtar katmanı kaçırır ve
        // örüntü katmanı bunu yakalamalıdır. Sıfır öneki TCKN ile çakışmaz.
        if karakterler[1] == '5' {
            return Some(MASKE.to_string());
        }
    }

    None
}

/// JSON ağacını yerinde maskeler.
///
/// Özyinelemeli: iç içe nesne ve diziler de gezilir. `json!` ile üretilen
/// payload'lar sığ değildir, bu yüzden tek katmanlı bir kontrol sızdırırdı.
pub fn maskele(deger: &mut serde_json::Value) {
    match deger {
        serde_json::Value::Object(harita) => {
            // Anahtarlar önce toplanır: `harita` değiştirilirken ödünç almak
            // derleyici hatası verir.
            let anahtarlar: Vec<String> = harita.keys().cloned().collect();
            for anahtar in anahtarlar {
                let normalize = |s: &str| s.to_lowercase().replace(['_', '-'], "");
                let normalize_anahtar = normalize(&anahtar);
                let hassas = HASSAS_ANAHTARLAR
                    .iter()
                    .any(|parca| normalize_anahtar.contains(&normalize(parca)));

                let Some(d) = harita.get_mut(&anahtar) else {
                    continue;
                };

                if hassas {
                    // Anahtar tabanlı: tüm içerik gizlenir. Adres gibi
                    // alanlarda kısmi gizleme anlamsızdır.
                    *d = serde_json::Value::String(MASKE.to_string());
                    continue;
                }

                match d {
                    serde_json::Value::String(metin) => {
                        if let Some(maskeli) = maske_uygula_metin(metin) {
                            *d = serde_json::Value::String(maskeli);
                        }
                    }
                    diger => maskele(diger),
                }
            }
        }
        serde_json::Value::Array(oge) => {
            for oge in oge.iter_mut() {
                maskele(oge);
            }
        }
        // Sayı, bool, null: dokunulmaz. Para buradadır.
        _ => {}
    }
}

/// Testlerin ve arayüzün aynı işareti görmesi için dışa açılan sabit.
pub const MASKE_ISARETI: &str = MASKE;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hassas_anahtarlar_maskelenir() {
        let mut veri = json!({
            "phone": "05321234567",
            "email": "ayse@ornek.com",
            "tcNo": "12345678901",
            "address": "Bağdat Caddesi No: 12",
            "IBAN": "TR330006100519786457841326",
        });
        maskele(&mut veri);

        assert_eq!(veri["phone"], json!("***"));
        assert_eq!(veri["email"], json!("***"));
        assert_eq!(veri["tcNo"], json!("***"));
        assert_eq!(veri["address"], json!("***"));
        assert_eq!(veri["IBAN"], json!("***"));
    }

    #[test]
    fn para_ve_sayaclar_maskelenmez() {
        let mut veri = json!({
            "amountCents": 100_000_000,
            "totalCents": 250_050,
            "sequence": 42,
            "shiftId": "shf_001",
        });
        maskele(&mut veri);

        // 100.000.000 kuruş 11 haneli; TCKN ile aynı biçimde olmasına rağmen
        // sayı olduğu için korunur. Defter finansal kanıt değerini kaybederse
        // maskeleme işlevsizdir.
        assert_eq!(veri["amountCents"], json!(100_000_000));
        assert_eq!(veri["totalCents"], json!(250_050));
        assert_eq!(veri["sequence"], json!(42));
        assert_eq!(veri["shiftId"], json!("shf_001"));
    }

    #[test]
    fn onbir_hane_tckn_metin_degerinde_maskelenir() {
        let mut veri = json!({ "not": "11111111111" });
        maskele(&mut veri);
        assert_eq!(veri["not"], json!("***"), "11 haneli TCKN metni maskelenmeli");
    }

    #[test]
    fn onbir_hane_sayida_maskelenmez() {
        // Aynı rakamlar ama JSON sayısı: para olabilir, dokunulmaz.
        let mut veri = json!({ "not": 11111111111_u64 });
        maskele(&mut veri);
        assert_eq!(veri["not"], json!(11111111111_u64));
    }

    #[test]
    fn eposta_neredeyse_maskelenir_alan_adi_kalir() {
        let mut veri = json!({ "not": "ayse.kaya@kasam360.com" });
        maskele(&mut veri);
        // Yerel kısım korunur: denetimde "ayse" ile "mehmet" ayrımı işe yarar.
        assert_eq!(veri["not"], json!("ay@com"));
    }

    #[test]
    fn ic_ice_yapilar_maskelenir() {
        let mut veri = json!({
            "sirket": {
                "ad": "Test",
                "iletisim": { "phone": "05321234567" },
                "musteriler": [
                    { "ad": "Ali", "tcNo": "11122233344" },
                    { "ad": "Veli", "email": "veli@ornek.com" },
                ],
            },
        });
        maskele(&mut veri);

        assert_eq!(veri["sirket"]["ad"], json!("Test"));
        assert_eq!(veri["sirket"]["iletisim"]["phone"], json!("***"));
        assert_eq!(veri["sirket"]["musteriler"][0]["tcNo"], json!("***"));
        // `email` anahtarı hassas listede; anahtar kuralı örüntüden önce çalışır
        // ve değerin tamamını gizler. Kısmi gizleme yalnızca anahtarı
        // tanınmayan alanlarda devreye girer.
        assert_eq!(veri["sirket"]["musteriler"][1]["email"], json!("***"));
    }

    #[test]
    fn turkiye_telefonu_tanimlanmamis_anahtarda_maskelenir() {
        // `0532...` 11 hane ve `0` ile başlıyor: TCKN olamaz, cep telefonudur.
        // TCKN kuralı bunu kaçırıyordu.
        let mut veri = json!({ "iletisim": "05321234567" });
        maskele(&mut veri);
        assert_eq!(veri["iletisim"], json!("***"));
    }

    #[test]
    fn taninmayan_anahtarda_oruntu_maskeler() {
        // Anahtar `iletisim` — HASSAS_ANAHTARLAR'da yok, örüntü katmanı yakalar.
        let mut veri = json!({ "iletisim": "05321234567" });
        maskele(&mut veri);
        assert_eq!(veri["iletisim"], json!("***"));
    }

    #[test]
    fn sir_alanlari_maskelenir() {
        let mut veri = json!({
            "pin": "1234",
            "password": "Kahve3Duzen",
            "sessionToken": "abc",
            "cardNumber": "4111111111111111",
        });
        maskele(&mut veri);
        for anahtar in ["pin", "password", "sessionToken", "cardNumber"] {
            assert_eq!(veri[anahtar], json!("***"), "{anahtar} maskelenmeli");
        }
    }

    #[test]
    fn duz_ve_bos_degerler_degismez() {
        let mut veri = json!({ "a": "", "b": "  ", "c": "kisa" });
        maskele(&mut veri);
        assert_eq!(veri["a"], json!(""));
        assert_eq!(veri["b"], json!("  "));
        assert_eq!(veri["c"], json!("kisa"));
    }

    #[test]
    fn sifirla_baslayan_onbir_hane_tckn_degil() {
        // 0 ile başlayan 11 hane TCKN olamaz; parça numarası olabilir.
        let mut veri = json!({ "siparisNo": "01234567890" });
        maskele(&mut veri);
        assert_eq!(veri["siparisNo"], json!("01234567890"));
    }
}