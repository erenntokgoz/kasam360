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

/// Bu parçalar başka kelimelerin **içinde** geçtiği için tek başına
/// maskeleme gerekçesi sayılmaz.
///
/// Neden: `shippingCost` içinde `pin` geçer. Kargo ücreti `***` olursa defter
/// finansal kanıtını kaybeder — para alanlarının maskelenmemesi kuralı, bu
/// yüzden sızan veriden daha güçlüdür. `accept` içinde `cep`, `company`
/// içinde `pan` geçer.
const KISA_PARCA: &[&str] = &["pin", "pan", "cep", "card"];

/// Yukarıdaki çakışmaları taşıyan gerçek kelimeler.
///
/// Bunlar maskelenmez **yalnız** başka bir hassas parça isabet etmiyorsa:
/// `shippingAddress` yine maskelenir (`address`), `shippingCost` maskelenmez.
const KACIS_KELIMELERI: &[&str] = &[
    "shipping", "spin", "spinning", "accept", "concept", "company", "companion", "expansion",
    "panel", "pano", "discard",
];

/// Verilen konum, bir kaçış kelimesinin **içinde** mi?
///
/// Neden konum denetleniyor: `shippingPanelPin` içinde `pin` gerçek bir PIN
/// alanıdır ama `shipping` kelimesi de geçiyor. Yalnız kelime varlığına
/// bakarsak gerçek PIN'i kaçırırız. Eşleşme kaçış kelimesinin içinde değilse
/// o eşleşme kendi başına bir alandır.
fn konum_kacis_kelimesi_icinde(metin: &str, konum: usize, parca_uzunlugu: usize) -> bool {
    KACIS_KELIMELERI.iter().any(|kelime| {
        metin
            .match_indices(kelime)
            .any(|(bas, _)| konum >= bas && konum + parca_uzunlugu <= bas + kelime.len())
    })
}

/// Anahtar hassas mı?
///
/// Neden sıra önemli: önce uzun ve tartışmasız parçalar denenir. Bir parça
/// isabet ederse kısa parçaların çakışma denetimi hiç çalışmaz — bu yüzden
/// `shippingAddress` maskelenirken `shippingCost` maskelenmez.
fn hassas_anahtar_mi(anahtar: &str) -> bool {
    let normalize = |s: &str| s.to_lowercase().replace(['_', '-'], "");
    let normalize_anahtar = normalize(anahtar);

    let uzun_isabet = HASSAS_ANAHTARLAR
        .iter()
        .any(|parca| !KISA_PARCA.contains(parca) && normalize_anahtar.contains(&normalize(parca)));
    if uzun_isabet {
        return true;
    }

    // Kısa parçaların **her** eşleşme konumu için kaçış denetimi yapılır.
    let kacirilan: Vec<bool> = KISA_PARCA
        .iter()
        .flat_map(|parca| {
            normalize_anahtar
                .match_indices(parca)
                .map(move |(konum, _)| (konum, parca.len()))
        })
        .map(|(konum, uzunluk)| konum_kacis_kelimesi_icinde(&normalize_anahtar, konum, uzunluk))
        .collect();

    // En az bir eşleşme kaçış kelimesinin dışındaysa alan hassastır. Hiç kısa
    // parça geçmiyorsa vektör boştur; boş listede `all` `true` döndüğü için
    // sonuç `false` olur — yani alan hassas değildir.
    !kacirilan.iter().all(|kacirildi| *kacirildi)
}

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
    //
    // Neden `chars().take(2)`: `&yerel[..2]` **bayt** dilimler ve `áy@...`
    // gibi bir yerel kısımda 2. baytı `á`nın ortasından keser. Denetim
    // yazma yolunda panic üretir — sessiz hatadan çok daha kötü.
    if let Some((yerel, alan)) = kirp.split_once('@') {
        if alan.contains('.') {
            let son = alan.rsplit('.').next().unwrap_or(MASKE);
            let bas: String = yerel.chars().take(2).collect();
            return Some(format!("{}@{}", bas, son));
        }
    }

    // IBAN: TR + 24 hane. Uzunluğu ülke kodu ile tutarlı tek biçim.
    if kirp.len() == 26
        && kirp.chars().all(|c| c.is_ascii_alphanumeric())
        && kirp.to_uppercase().starts_with("TR")
    {
        return Some(MASKE.to_string());
    }

    // Türkiye telefonu: alan adı tanınmayan anahtarda `+90`/`0090` önekiyle
    // de yazılır. Önek atılmadan 11 haneli kontrolü tutmaz; sistemde
    // `+905321234567` biçimi yaygın olduğu için ayrı ele alınır.
    //
    // Neden yalnız rakam/ayraç kontrolü: metnin rakamları süzülürse
    // "Fatura 12345678901" gibi bir açıklama TCKN sanılır. Ayraç dışındaki
    // her karakter telefon ihtimalini düşürür.
    let telefon_bicimi = kirp
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'));
    if telefon_bicimi {
        let rakam: String = kirp.chars().filter(|c| c.is_ascii_digit()).collect();
        let govde = if let Some(kalan) = rakam.strip_prefix("0090") {
            kalan
        } else if let Some(kalan) = rakam.strip_prefix("90") {
            kalan
        } else {
            rakam.as_str()
        };
        // Ülke öneki atılınca trunk `0` kaybolur: `+90 532...` -> `532...`.
        // 10 haneyi 11 haneye getirmek bu yüzden zorunlu.
        let govde = if govde.len() == 10 && !govde.starts_with('0') {
            format!("0{govde}")
        } else {
            govde.to_string()
        };

        if govde.len() == 11 && govde.starts_with('0') && govde.as_bytes()[1] == b'5' {
            return Some(MASKE.to_string());
        }
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
                let hassas = hassas_anahtar_mi(&anahtar);

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

    #[test]
    fn unicode_eposta_yerel_kismi_panic_uretmez() {
        // Regresyon: eski yazım `&yerel[..yerel.len().min(2)]` idi ve `áy`
        // yerel ksminda karakter sınırından kesilerek panic üretiyordu.
        let mut veri = json!({ "not": "áyşenur.kaya@kasam360.com" });
        maskele(&mut veri);
        // `áyşenur.kaya` yerel kısmında 2 **karakter** `á` ve `y`.
        assert_eq!(veri["not"], json!("áy@com"));
    }

    #[test]
    fn tek_karakterli_ve_bos_yerel_kisimli_eposta_guvenli() {
        for adres in ["a@b.co", "1@b.co", "@b.co", "ç@b.co"] {
            let mut veri = json!({ "not": adres });
            maskele(&mut veri);
            // Önemli olan: panic olmaması ve çıktının geçerli metin olması.
            assert!(veri["not"].is_string(), "{adres} metin kalmali");
        }
    }

    #[test]
    fn kargo_ucreti_maskelenmez_kargo_adresi_maskelenir() {
        // Regresyon: `shippingCost` içinde `pin` geçtiği için tutar `***`
        // oluyordu. Para alanının kaybı, sızan veriden daha kötüdür.
        let mut veri = json!({
            "shippingCost": 4500,
            "shippingAddress": "Bağdat Caddesi No: 12",
        });
        maskele(&mut veri);
        assert_eq!(veri["shippingCost"], json!(4500), "kargo tutari korunmali");
        assert_eq!(veri["shippingAddress"], json!("***"), "adres yine maskeli");
    }

    #[test]
    fn kisaparca_cakismalari_maskelenmez() {
        // `accept` -> cep, `company` -> pan, `panel` -> pan.
        let mut veri = json!({
            "acceptLanguage": "tr-TR",
            "companyName": "Kahve Dünyası",
            "panelWidth": 1280,
            "spinCount": 3,
        });
        maskele(&mut veri);
        assert_eq!(veri["acceptLanguage"], json!("tr-TR"));
        assert_eq!(veri["companyName"], json!("Kahve Dünyası"));
        assert_eq!(veri["panelWidth"], json!(1280));
        assert_eq!(veri["spinCount"], json!(3));
    }

    #[test]
    fn kisaparcalar_yine_hassas_alanlari_maskeler() {
        // Kaçış kelimesi yalnız kısa parçayı tetikliyorsa istisnadır; gerçek
        // PIN/CEP/kart alanları maskelenmeye devam eder.
        let mut veri = json!({
            "userPin": "1234",
            "musteriCep": "05321234567",
            "mustericep": "05321234567",
            "cardNumber": "4111111111111111",
            "kartNo": "1234567890123456",
            "creditcard": "4111111111111111",
            "shippingPanelPin": "1234",
        });
        maskele(&mut veri);
        for anahtar in [
            "userPin",
            "musteriCep",
            "mustericep",
            "cardNumber",
            "kartNo",
            "creditcard",
            "shippingPanelPin",
        ] {
            assert_eq!(veri[anahtar], json!("***"), "{anahtar} maskelenmeli");
        }
    }

    #[test]
    fn onnine_kosulu_ve_ayracli_telefon_maskelenir() {
        let mut veri = json!({
            "a": "+905321234567",
            "b": "00905321234567",
            "c": "+90 532 123 45 67",
            "d": "0532 123 45 67",
        });
        maskele(&mut veri);
        for anahtar in ["a", "b", "c", "d"] {
            assert_eq!(veri[anahtar], json!("***"), "{anahtar} maskelenmeli");
        }
    }

    #[test]
    fn sabit_hat_ve_yurt_disi_numara_maskelenmez() {
        // Alan adı bilinmediği için örüntü katmanı çalışır; sabit hat (0 5XX
        // değil) ve yurt dışı numara TCKN sanılmamalı.
        let mut veri = json!({
            "iletisim": "02125550123",
            "uluslararasi": "+14155552671",
        });
        maskele(&mut veri);
        assert_eq!(veri["iletisim"], json!("02125550123"));
        assert_eq!(veri["uluslararasi"], json!("+14155552671"));
    }

    #[test]
    fn aciklamadaki_tckn_bicimi_telefon_kaniti_olmaz() {
        // Metin rakamları süzülürse "Fatura 12345678901" TCKN sanılır ve
        // açıklama kaybolur. Ayraç dışı karakter varsa telefon sayılmaz.
        let mut veri = json!({ "aciklama": "Fatura 11111111111" });
        maskele(&mut veri);
        assert_eq!(veri["aciklama"], json!("Fatura 11111111111"));
    }
}