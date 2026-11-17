//! e-Adisyon XML şema testleri: örnek adisyon → kılavuzdaki beklenen alanlar.

use chrono::{TimeZone, Utc};

use super::model::{AdisyonDocument, DocumentLine, PaymentLine, Supplier};
use super::tax_id::TaxIdKind;
use super::xml::{build_xml, money_text, rate_text, unit_price_text};

const ETTN: &str = "e093a490-dd99-11dd-ad8b-0800200c9a66";
const SESSION: &str = "e093a490-dd99-11dd-ad8b-0800200c9a99";

fn sample() -> AdisyonDocument {
    AdisyonDocument {
        ettn: ETTN.to_string(),
        session_ettn: SESSION.to_string(),
        document_number: "ADS2026000000001".to_string(),
        // 20:30 UTC = 23:30 Türkiye; kapanış gece yarısını aşar.
        opened_at: Utc.with_ymd_and_hms(2026, 3, 1, 20, 30, 0).unwrap(),
        closed_at: Utc.with_ymd_and_hms(2026, 3, 1, 21, 30, 0).unwrap(),
        table_name: "B11".to_string(),
        cashier_name: "Ayşe".to_string(),
        supplier: Supplier {
            tax_id: "0690000001".to_string(),
            tax_id_kind: TaxIdKind::Vkn,
            legal_name: "Örnek Lokanta Ltd. Şti.".to_string(),
            tax_office: "Küçükçekmece".to_string(),
            street: "Florya Cd. No:7".to_string(),
            district: "Bakırköy".to_string(),
            city: "İstanbul".to_string(),
        },
        lines: vec![
            DocumentLine {
                name: "Çay & Simit <özel>".to_string(),
                quantity: 2,
                net_cents: 4545,
                tax_cents: 455,
                gross_cents: 5000,
                tax_rate_bp: 1000,
            },
            DocumentLine {
                name: "Su".to_string(),
                quantity: 1,
                net_cents: 10000,
                tax_cents: 800,
                gross_cents: 10800,
                tax_rate_bp: 800,
            },
        ],
        payments: vec![
            PaymentLine {
                method: "NAKIT".to_string(),
                amount_cents: 10000,
            },
            PaymentLine {
                method: "KART".to_string(),
                amount_cents: 5800,
            },
        ],
    }
}

fn xml() -> String {
    build_xml(&sample()).expect("örnek belge üretilir")
}

/// Etiketlerin eşleştiğini doğrular; tam bir ayrıştırıcı bağımlılığı eklemeden iyi biçimlilik denetimi.
fn assert_balanced(xml: &str) {
    let mut stack: Vec<String> = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        let end = rest[start..].find('>').expect("etiket kapanır") + start;
        let tag = &rest[start + 1..end];
        rest = &rest[end + 1..];
        if tag.starts_with('?') || tag.ends_with('/') {
            continue;
        }
        if let Some(name) = tag.strip_prefix('/') {
            assert_eq!(stack.pop().as_deref(), Some(name), "kapanış eşleşmedi");
        } else {
            stack.push(tag.split_whitespace().next().unwrap_or("").to_string());
        }
    }
    assert!(stack.is_empty(), "açık etiket kaldı: {stack:?}");
}

#[test]
fn belge_iyi_bicimli_ve_utf8_basliklidir() {
    let body = xml();
    assert!(body.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    assert_balanced(&body);
}

#[test]
fn zorunlu_ust_alanlar_kilavuzdaki_degerlerle_yazilir() {
    let body = xml();
    for expected in [
        "<cbc:UBLVersionID>2.1</cbc:UBLVersionID>",
        "<cbc:CustomizationID>TR1.2.1</cbc:CustomizationID>",
        "<cbc:ProfileID>EARSIVBELGE</cbc:ProfileID>",
        "<cbc:ID>ADS2026000000001</cbc:ID>",
        "<cbc:CopyIndicator>false</cbc:CopyIndicator>",
        "<cbc:UUID>e093a490-dd99-11dd-ad8b-0800200c9a66</cbc:UUID>",
        "<cbc:CreditNoteTypeCode>ADISYON</cbc:CreditNoteTypeCode>",
        "<ext:ExtensionContent/>",
    ] {
        assert!(body.contains(expected), "eksik alan: {expected}");
    }
}

#[test]
fn tarih_ve_saat_turkiye_saatine_cevrilir_gece_yarisini_asar() {
    let body = xml();
    // 21:30 UTC kapanış = 2026-03-02 00:30 Türkiye.
    assert!(body.contains("<cbc:IssueDate>2026-03-02</cbc:IssueDate>"));
    assert!(body.contains("<cbc:IssueTime>00:30:00</cbc:IssueTime>"));
    assert!(body.contains("<cbc:StartDate>2026-03-01</cbc:StartDate>"));
    assert!(body.contains("<cbc:StartTime>23:30:00.000</cbc:StartTime>"));
    assert!(body.contains("<cbc:EndDate>2026-03-02</cbc:EndDate>"));
    assert!(body.contains("<cbc:EndTime>00:30:00.000</cbc:EndTime>"));
    assert!(body.contains(
        "<cbc:ID schemeID=\"ADISYON_SESSION\">e093a490-dd99-11dd-ad8b-0800200c9a99</cbc:ID>"
    ));
    assert!(body.contains("<cbc:DocumentDescription>ADISYON</cbc:DocumentDescription>"));
}

#[test]
fn taraflar_ve_masa_bilgisi_yazilir() {
    let body = xml();
    assert!(body.contains("<cbc:ID schemeID=\"VKN\">0690000001</cbc:ID>"));
    assert!(body.contains("<cbc:Name>Örnek Lokanta Ltd. Şti.</cbc:Name>"));
    assert!(body.contains("<cbc:Name>Küçükçekmece</cbc:Name>"));
    assert!(body.contains("<cbc:CityName>İstanbul</cbc:CityName>"));
    assert!(body.contains("<cbc:ID schemeID=\"TCKN\">11111111111</cbc:ID>"));
    assert!(body.contains("<cbc:ID schemeID=\"MASA_NO\">B11</cbc:ID>"));
    assert!(body.contains("<cbc:ID schemeID=\"KULLANICI\">Ayşe</cbc:ID>"));
    assert!(body.contains("<cbc:URI>#Signature_e093a490-dd99-11dd-ad8b-0800200c9a66</cbc:URI>"));
}

#[test]
fn tckn_duzenleyen_icin_scheme_tckn_olur() {
    let mut doc = sample();
    doc.supplier.tax_id = "10000000146".to_string();
    doc.supplier.tax_id_kind = TaxIdKind::Tckn;
    let body = build_xml(&doc).expect("üretilir");
    assert!(body.contains("<cbc:ID schemeID=\"TCKN\">10000000146</cbc:ID>"));
    assert!(!body.contains("schemeID=\"VKN\""));
}

#[test]
fn kdv_oran_bazinda_gruplanir_ve_toplamlar_kurus_dogrudur() {
    let body = xml();
    // Üst düzey vergi toplamı: 4,55 + 8,00 = 12,55.
    assert!(body.contains("<cbc:TaxAmount currencyID=\"TRY\">12.55</cbc:TaxAmount>"));
    assert!(body.contains("<cbc:Percent>10</cbc:Percent>"));
    assert!(body.contains("<cbc:Percent>8</cbc:Percent>"));
    assert!(body.contains("<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>"));
    assert!(body.contains("<cbc:Name>Katma Değer Vergisi</cbc:Name>"));
    assert!(body.contains("<cbc:TaxableAmount currencyID=\"TRY\">45.45</cbc:TaxableAmount>"));
    assert!(body.contains("<cbc:TaxableAmount currencyID=\"TRY\">100.00</cbc:TaxableAmount>"));
    assert!(body
        .contains("<cbc:LineExtensionAmount currencyID=\"TRY\">145.45</cbc:LineExtensionAmount>"));
    assert!(
        body.contains("<cbc:TaxExclusiveAmount currencyID=\"TRY\">145.45</cbc:TaxExclusiveAmount>")
    );
    assert!(
        body.contains("<cbc:TaxInclusiveAmount currencyID=\"TRY\">158.00</cbc:TaxInclusiveAmount>")
    );
    assert!(body.contains("<cbc:PayableAmount currencyID=\"TRY\">158.00</cbc:PayableAmount>"));
    // Matrah + KDV = KDV dahil toplam: 145,45 + 12,55 = 158,00.
    assert_eq!(14545 + 1255, 15800);
}

#[test]
fn kalemler_numarali_ve_kdv_haric_birim_fiyatlidir() {
    let body = xml();
    assert!(body.contains("<cbc:CreditedQuantity unitCode=\"C62\">2</cbc:CreditedQuantity>"));
    // 45,45 / 2 = 22,725 → dört ondalık.
    assert!(body.contains("<cbc:PriceAmount currencyID=\"TRY\">22.7250</cbc:PriceAmount>"));
    assert!(body.contains("<cbc:PriceAmount currencyID=\"TRY\">100.0000</cbc:PriceAmount>"));
    assert_eq!(body.matches("<cac:CreditNoteLine>").count(), 2);
    assert!(body.contains("<cbc:Name>Çay &amp; Simit &lt;özel&gt;</cbc:Name>"));
}

#[test]
fn odeme_dagilimi_not_olarak_yazilir() {
    let body = xml();
    assert!(body.contains("<cbc:Note>ODEME:NAKIT:100.00</cbc:Note>"));
    assert!(body.contains("<cbc:Note>ODEME:KART:58.00</cbc:Note>"));
}

#[test]
fn ana_elemanlar_kilavuzdaki_siradadir() {
    let body = xml();
    let order = [
        "<ext:UBLExtensions>",
        "<cbc:UBLVersionID>",
        "<cbc:ProfileID>",
        "<cbc:UUID>",
        "<cbc:IssueDate>",
        "<cbc:CreditNoteTypeCode>",
        "<cbc:Note>",
        "<cac:AdditionalDocumentReference>",
        "<cac:Signature>",
        "<cac:AccountingSupplierParty>",
        "<cac:AccountingCustomerParty>",
        "<cac:SellerSupplierParty>",
        "<cac:LegalMonetaryTotal>",
        "<cac:CreditNoteLine>",
    ];
    let positions: Vec<usize> = order
        .iter()
        .map(|tag| body.find(tag).unwrap_or_else(|| panic!("yok: {tag}")))
        .collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "sıra bozuk");
    // Belge düzeyi TaxTotal, parasal toplamdan önce ve taraflardan sonradır.
    let tax_total = body.find("<cac:TaxTotal>").unwrap_or(usize::MAX);
    let monetary = body.find("<cac:LegalMonetaryTotal>").unwrap_or(0);
    let first_line = body.find("<cac:CreditNoteLine>").unwrap_or(0);
    assert!(body.find("<cac:SellerSupplierParty>").unwrap_or(usize::MAX) < tax_total);
    assert!(tax_total < monetary);
    assert!(monetary < first_line);
}

#[test]
fn hatali_belge_uretilmez() {
    let mut bad_number = sample();
    bad_number.document_number = "ADS2026".to_string();
    assert!(build_xml(&bad_number).is_err());

    let mut bad_uuid = sample();
    bad_uuid.ettn = "uuid-degil".to_string();
    assert!(build_xml(&bad_uuid).is_err());

    let mut mismatch = sample();
    mismatch.lines[0].gross_cents = 5001;
    assert!(build_xml(&mismatch).is_err());

    let mut empty = sample();
    empty.lines.clear();
    assert!(build_xml(&empty).is_err());

    let mut reversed = sample();
    reversed.closed_at = reversed.opened_at - chrono::Duration::minutes(1);
    assert!(build_xml(&reversed).is_err());

    let mut no_office = sample();
    no_office.supplier.tax_office = " ".to_string();
    assert!(build_xml(&no_office).is_err());
}

#[test]
fn bicim_yardimcilari_tamsayi_bolmesiyle_calisir() {
    assert_eq!(money_text(0), "0.00");
    assert_eq!(money_text(5), "0.05");
    assert_eq!(money_text(125_050), "1250.50");
    assert_eq!(rate_text(1000), "10");
    assert_eq!(rate_text(150), "1.50");
    assert_eq!(unit_price_text(4545, 2), "22.7250");
    assert_eq!(unit_price_text(1, 3), "0.0033");
}
