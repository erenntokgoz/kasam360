//! e-Adisyon belge modeli: XML üreticinin girdisi.
//!
//! Neden ayrı model: XML üretimi veritabanını bilmez; adisyon verisi `source`
//! tarafından bu yapıya çevrilir, böylece şema doğruluğu veritabanı olmadan test edilir.

use chrono::{DateTime, Utc};

use super::tax_id::TaxIdKind;

/// Belgeyi düzenleyen işletme (AccountingSupplierParty).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Supplier {
    pub tax_id: String,
    pub tax_id_kind: TaxIdKind,
    pub legal_name: String,
    pub tax_office: String,
    pub street: String,
    pub district: String,
    pub city: String,
}

/// Adisyon kalemi. Tutarlar kuruştur; `gross = net + tax` değişmezi XML üretiminde doğrulanır.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentLine {
    pub name: String,
    pub quantity: i64,
    pub net_cents: i64,
    pub tax_cents: i64,
    pub gross_cents: i64,
    /// KDV oranı binde (basis point): %10 = 1000.
    pub tax_rate_bp: i64,
}

/// Ödeme yöntemi bazında tahsil edilen tutar (NAKIT, KART, YEMEK_KARTI, VERESIYE).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentLine {
    pub method: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdisyonDocument {
    /// Belge ETTN'i (UUID).
    pub ettn: String,
    /// Adisyon oturumunun ayrı UUID'si (`ADISYON_SESSION` referansı).
    pub session_ettn: String,
    /// 3 haneli birim kodu + 13 haneli müteselsil numara.
    pub document_number: String,
    pub opened_at: DateTime<Utc>,
    pub closed_at: DateTime<Utc>,
    pub table_name: String,
    pub cashier_name: String,
    pub supplier: Supplier,
    pub lines: Vec<DocumentLine>,
    pub payments: Vec<PaymentLine>,
}
