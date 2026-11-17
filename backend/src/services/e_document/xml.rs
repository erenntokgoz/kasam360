//! UBL-TR e-Adisyon XML üreticisi (GİB e-Adisyon Belgesi Teknik Kılavuzu v1.0, Temmuz 2021).
//!
//! Belge `CreditNote` kökünde, `CreditNoteTypeCode = ADISYON` ile kurulur. İmza alanı
//! (`UBLExtensions`) bilerek boş bırakılır: mali mühür/e-imza sağlayıcı tarafında
//! `EDocumentProvider::sign` ile eklenir; anahtar bu uygulamada bulunmaz.
//!
//! Tutarlar kuruş tamsayısıdır ve metne yalnız tamsayı bölmesiyle çevrilir; float yoktur.
//! Tarih ve saat Türkiye saatidir (UTC+3 sabit; 2016'dan beri yaz saati uygulaması yok).

use chrono::{DateTime, FixedOffset, Utc};
use uuid::Uuid;

use super::model::{AdisyonDocument, DocumentLine};

const TURKEY_OFFSET_SECONDS: i32 = 3 * 3600;

struct Writer {
    out: String,
    depth: usize,
}

impl Writer {
    fn line(&mut self, text: &str) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn open(&mut self, tag: &str) {
        self.line(&format!("<{tag}>"));
        self.depth += 1;
    }

    fn close(&mut self, tag: &str) {
        self.depth = self.depth.saturating_sub(1);
        self.line(&format!("</{tag}>"));
    }

    fn leaf(&mut self, tag: &str, text: &str) {
        self.line(&format!("<{tag}>{}</{tag}>", escape(text)));
    }

    fn leaf_attr(&mut self, tag: &str, attr: &str, attr_value: &str, text: &str) {
        self.line(&format!(
            "<{tag} {attr}=\"{}\">{}</{tag}>",
            escape(attr_value),
            escape(text)
        ));
    }

    fn amount(&mut self, tag: &str, cents: i64) {
        self.line(&format!(
            "<{tag} currencyID=\"TRY\">{}</{tag}>",
            money_text(cents)
        ));
    }
}

/// XML'de geçersiz kontrol karakterlerini atar, özel karakterleri kaçırır.
pub(crate) fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

/// Kuruşu `12.34` biçimine çevirir (negatif tutar belgede yer almaz).
pub(crate) fn money_text(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

/// KDV oranı: binde → yüzde (`1000` → `10`, `150` → `1.50`).
pub(crate) fn rate_text(tax_rate_bp: i64) -> String {
    if tax_rate_bp % 100 == 0 {
        (tax_rate_bp / 100).to_string()
    } else {
        format!("{}.{:02}", tax_rate_bp / 100, tax_rate_bp % 100)
    }
}

/// Birim fiyat (KDV hariç) dört ondalıkla; kuruş/adet bölümü yarım yukarı yuvarlanır.
pub(crate) fn unit_price_text(net_cents: i64, quantity: i64) -> String {
    let units = (i128::from(net_cents) * 200 + i128::from(quantity)) / (2 * i128::from(quantity));
    format!("{}.{:04}", units / 10_000, units % 10_000)
}

fn local(time: DateTime<Utc>) -> Result<DateTime<FixedOffset>, String> {
    let offset = FixedOffset::east_opt(TURKEY_OFFSET_SECONDS)
        .ok_or_else(|| "saat dilimi oluşturulamadı".to_string())?;
    Ok(time.with_timezone(&offset))
}

fn validate(doc: &AdisyonDocument) -> Result<(), String> {
    for (label, value) in [("ettn", &doc.ettn), ("session_ettn", &doc.session_ettn)] {
        Uuid::parse_str(value).map_err(|_| format!("VALIDATION: {label} UUID olmalı"))?;
    }
    let number = doc.document_number.as_bytes();
    let number_ok = number.len() == 16
        && number[..3]
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && number[3..].iter().all(u8::is_ascii_digit);
    if !number_ok {
        return Err("VALIDATION: belge numarası 3 karakter birim kodu + 13 rakam olmalı".into());
    }
    if doc.closed_at < doc.opened_at {
        return Err("VALIDATION: kapanış zamanı açılıştan önce olamaz".into());
    }
    let supplier = &doc.supplier;
    if supplier.legal_name.trim().is_empty()
        || supplier.tax_office.trim().is_empty()
        || supplier.city.trim().is_empty()
    {
        return Err("VALIDATION: unvan, vergi dairesi ve şehir zorunlu".into());
    }
    if doc.lines.is_empty() {
        return Err("VALIDATION: belgede en az bir kalem olmalı".into());
    }
    for line in &doc.lines {
        let sum = line.net_cents.checked_add(line.tax_cents);
        if line.name.trim().is_empty()
            || line.quantity <= 0
            || line.net_cents < 0
            || line.tax_cents < 0
            || line.tax_rate_bp < 0
            || sum != Some(line.gross_cents)
        {
            return Err(format!("VALIDATION: kalem tutarsız: {}", line.name));
        }
    }
    if doc.payments.iter().any(|p| p.amount_cents < 0) {
        return Err("VALIDATION: negatif ödeme tutarı".into());
    }
    Ok(())
}

/// Aynı KDV oranına düşen kalemlerin toplamı.
struct RateGroup {
    tax_rate_bp: i64,
    taxable_cents: i64,
    tax_cents: i64,
}

fn sum_cents(mut values: impl Iterator<Item = i64>) -> Result<i64, String> {
    values.try_fold(0_i64, |acc, v| {
        acc.checked_add(v)
            .ok_or_else(|| "OVERFLOW: belge toplamı taştı".to_string())
    })
}

fn group_by_rate(lines: &[DocumentLine]) -> Result<Vec<RateGroup>, String> {
    let mut rates: Vec<i64> = lines.iter().map(|l| l.tax_rate_bp).collect();
    rates.sort_unstable();
    rates.dedup();
    rates
        .into_iter()
        .map(|rate| {
            let of_rate = || lines.iter().filter(move |l| l.tax_rate_bp == rate);
            Ok(RateGroup {
                tax_rate_bp: rate,
                taxable_cents: sum_cents(of_rate().map(|l| l.net_cents))?,
                tax_cents: sum_cents(of_rate().map(|l| l.tax_cents))?,
            })
        })
        .collect()
}

fn write_tax_subtotal(w: &mut Writer, sequence: usize, group: &RateGroup) {
    w.open("cac:TaxSubtotal");
    w.amount("cbc:TaxableAmount", group.taxable_cents);
    w.amount("cbc:TaxAmount", group.tax_cents);
    w.leaf("cbc:CalculationSequenceNumeric", &sequence.to_string());
    w.leaf("cbc:Percent", &rate_text(group.tax_rate_bp));
    w.open("cac:TaxCategory");
    w.open("cac:TaxScheme");
    w.leaf("cbc:Name", "Katma Değer Vergisi");
    w.leaf("cbc:TaxTypeCode", "0015");
    w.close("cac:TaxScheme");
    w.close("cac:TaxCategory");
    w.close("cac:TaxSubtotal");
}

fn write_address(w: &mut Writer, street: &str, district: &str, city: &str) {
    w.open("cac:PostalAddress");
    if !street.trim().is_empty() {
        w.leaf("cbc:StreetName", street);
    }
    if !district.trim().is_empty() {
        w.leaf("cbc:CitySubdivisionName", district);
    }
    w.leaf("cbc:CityName", city);
    w.open("cac:Country");
    w.leaf("cbc:Name", "Türkiye");
    w.close("cac:Country");
    w.close("cac:PostalAddress");
}

fn write_header(w: &mut Writer, doc: &AdisyonDocument) -> Result<(), String> {
    let issued = local(doc.closed_at)?;
    let opened = local(doc.opened_at)?;
    w.open("ext:UBLExtensions");
    w.open("ext:UBLExtension");
    w.line("<ext:ExtensionContent/>");
    w.close("ext:UBLExtension");
    w.close("ext:UBLExtensions");
    w.leaf("cbc:UBLVersionID", "2.1");
    w.leaf("cbc:CustomizationID", "TR1.2.1");
    w.leaf("cbc:ProfileID", "EARSIVBELGE");
    w.leaf("cbc:ID", &doc.document_number);
    w.leaf("cbc:CopyIndicator", "false");
    w.leaf("cbc:UUID", &doc.ettn);
    w.leaf("cbc:IssueDate", &issued.format("%Y-%m-%d").to_string());
    w.leaf("cbc:IssueTime", &issued.format("%H:%M:%S").to_string());
    w.leaf("cbc:CreditNoteTypeCode", "ADISYON");
    for payment in &doc.payments {
        w.leaf(
            "cbc:Note",
            &format!(
                "ODEME:{}:{}",
                payment.method,
                money_text(payment.amount_cents)
            ),
        );
    }
    // Açılış-kapanış anı, kılavuzun 1. maddesindeki ADISYON_SESSION referansıdır.
    w.open("cac:AdditionalDocumentReference");
    w.leaf_attr("cbc:ID", "schemeID", "ADISYON_SESSION", &doc.session_ettn);
    w.leaf("cbc:IssueDate", &issued.format("%Y-%m-%d").to_string());
    w.leaf("cbc:DocumentDescription", "ADISYON");
    w.open("cac:ValidityPeriod");
    w.leaf("cbc:StartDate", &opened.format("%Y-%m-%d").to_string());
    w.leaf("cbc:StartTime", &opened.format("%H:%M:%S.000").to_string());
    w.leaf("cbc:EndDate", &issued.format("%Y-%m-%d").to_string());
    w.leaf("cbc:EndTime", &issued.format("%H:%M:%S.000").to_string());
    w.close("cac:ValidityPeriod");
    w.close("cac:AdditionalDocumentReference");
    Ok(())
}

fn write_parties(w: &mut Writer, doc: &AdisyonDocument) {
    let s = &doc.supplier;
    w.open("cac:Signature");
    w.leaf("cbc:ID", &s.tax_id);
    w.open("cac:SignatoryParty");
    w.open("cac:PartyIdentification");
    w.leaf_attr("cbc:ID", "schemeID", s.tax_id_kind.scheme_id(), &s.tax_id);
    w.close("cac:PartyIdentification");
    write_address(w, &s.street, &s.district, &s.city);
    w.close("cac:SignatoryParty");
    w.open("cac:DigitalSignatureAttachment");
    w.open("cac:ExternalReference");
    w.leaf("cbc:URI", &format!("#Signature_{}", doc.ettn));
    w.close("cac:ExternalReference");
    w.close("cac:DigitalSignatureAttachment");
    w.close("cac:Signature");

    w.open("cac:AccountingSupplierParty");
    w.open("cac:Party");
    w.open("cac:PartyIdentification");
    w.leaf_attr("cbc:ID", "schemeID", s.tax_id_kind.scheme_id(), &s.tax_id);
    w.close("cac:PartyIdentification");
    w.open("cac:PartyName");
    w.leaf("cbc:Name", &s.legal_name);
    w.close("cac:PartyName");
    write_address(w, &s.street, &s.district, &s.city);
    w.open("cac:PartyTaxScheme");
    w.open("cac:TaxScheme");
    w.leaf("cbc:Name", &s.tax_office);
    w.close("cac:TaxScheme");
    w.close("cac:PartyTaxScheme");
    w.close("cac:Party");
    w.close("cac:AccountingSupplierParty");

    // Adisyonda alıcı bilinmez; GİB'in nihai tüketici kuralı olan sabit TCKN kullanılır.
    w.open("cac:AccountingCustomerParty");
    w.open("cac:Party");
    w.open("cac:PartyIdentification");
    w.leaf_attr("cbc:ID", "schemeID", "TCKN", "11111111111");
    w.close("cac:PartyIdentification");
    w.open("cac:PostalAddress");
    w.open("cac:Country");
    w.leaf("cbc:Name", "Türkiye");
    w.close("cac:Country");
    w.close("cac:PostalAddress");
    w.open("cac:Person");
    w.leaf("cbc:FirstName", "-");
    w.leaf("cbc:FamilyName", "-");
    w.close("cac:Person");
    w.close("cac:Party");
    w.close("cac:AccountingCustomerParty");

    w.open("cac:SellerSupplierParty");
    w.open("cac:Party");
    w.open("cac:PartyIdentification");
    w.leaf_attr("cbc:ID", "schemeID", "MASA_NO", &doc.table_name);
    w.close("cac:PartyIdentification");
    w.open("cac:PartyIdentification");
    w.leaf_attr("cbc:ID", "schemeID", "KULLANICI", &doc.cashier_name);
    w.close("cac:PartyIdentification");
    write_address(w, &s.street, &s.district, &s.city);
    w.close("cac:Party");
    w.close("cac:SellerSupplierParty");
}

fn write_line(w: &mut Writer, index: usize, line: &DocumentLine) {
    w.open("cac:CreditNoteLine");
    w.leaf("cbc:ID", &index.to_string());
    w.leaf_attr(
        "cbc:CreditedQuantity",
        "unitCode",
        "C62",
        &line.quantity.to_string(),
    );
    w.amount("cbc:LineExtensionAmount", line.net_cents);
    w.open("cac:TaxTotal");
    w.amount("cbc:TaxAmount", line.tax_cents);
    write_tax_subtotal(
        w,
        1,
        &RateGroup {
            tax_rate_bp: line.tax_rate_bp,
            taxable_cents: line.net_cents,
            tax_cents: line.tax_cents,
        },
    );
    w.close("cac:TaxTotal");
    w.open("cac:Item");
    w.leaf("cbc:Name", &line.name);
    w.close("cac:Item");
    w.open("cac:Price");
    w.line(&format!(
        "<cbc:PriceAmount currencyID=\"TRY\">{}</cbc:PriceAmount>",
        unit_price_text(line.net_cents, line.quantity)
    ));
    w.close("cac:Price");
    w.close("cac:CreditNoteLine");
}

/// Belgeyi doğrular ve imzasız UBL-TR XML'ini üretir.
pub fn build_xml(doc: &AdisyonDocument) -> Result<String, String> {
    validate(doc)?;
    let net_total = sum_cents(doc.lines.iter().map(|l| l.net_cents))?;
    let tax_total = sum_cents(doc.lines.iter().map(|l| l.tax_cents))?;
    let gross_total = sum_cents(doc.lines.iter().map(|l| l.gross_cents))?;
    let groups = group_by_rate(&doc.lines)?;

    let mut w = Writer {
        out: String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"),
        depth: 0,
    };
    w.line(
        "<CreditNote xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2\" \
         xmlns:cac=\"urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2\" \
         xmlns:cbc=\"urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2\" \
         xmlns:ext=\"urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2\" \
         xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\">",
    );
    w.depth = 1;
    write_header(&mut w, doc)?;
    write_parties(&mut w, doc);

    w.open("cac:TaxTotal");
    w.amount("cbc:TaxAmount", tax_total);
    for (i, group) in groups.iter().enumerate() {
        write_tax_subtotal(&mut w, i + 1, group);
    }
    w.close("cac:TaxTotal");

    w.open("cac:LegalMonetaryTotal");
    w.amount("cbc:LineExtensionAmount", net_total);
    w.amount("cbc:TaxExclusiveAmount", net_total);
    w.amount("cbc:TaxInclusiveAmount", gross_total);
    w.amount("cbc:PayableAmount", gross_total);
    w.close("cac:LegalMonetaryTotal");

    for (i, line) in doc.lines.iter().enumerate() {
        write_line(&mut w, i + 1, line);
    }
    w.depth = 0;
    w.line("</CreditNote>");
    Ok(w.out)
}
