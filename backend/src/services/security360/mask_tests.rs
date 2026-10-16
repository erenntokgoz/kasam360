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
    assert_eq!(
        veri["not"],
        json!("***"),
        "11 haneli TCKN metni maskelenmeli"
    );
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
