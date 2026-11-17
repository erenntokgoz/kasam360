//! Yazar kasa (YN ÖKC) alan tipleri ve hata sözleşmesi.
//!
//! Neden ayrı tipler: ÖKC mali belgeyi üretir; POS tarafı yalnız kuruş cinsinden
//! kalem, ödeme ve toplam bildirir. KDV tutarını hesaplayan taraf cihazdır
//! (GMP-3 §5.3.1), bu yüzden burada KDV oranı (baz puan) taşınır, KDV tutarı değil.
//! Her tutar tamsayı kuruştur; ondalık sayı hiçbir yerde kullanılmaz.

use thiserror::Error;

/// Yazar kasa katmanının tek hata tipi. Her hata fail-closed davranır:
/// belirsizlik "fiş kesildi" olarak yorumlanmaz.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum OkcError {
    #[error("Yazar kasa bağlı değil: {0}")]
    NotConnected(String),
    #[error("Yazar kasa ile eşleşme yok: {0}")]
    NotPaired(String),
    #[error("Yazar kasa iletişim hatası: {0}")]
    Transport(String),
    #[error("Yazar kasa zamanında yanıt vermedi.")]
    Timeout,
    #[error("Yazar kasa protokol hatası: {0}")]
    Protocol(String),
    /// Ödeme gönderildi ama kapanış doğrulanamadı. Fişin kesilip kesilmediği
    /// bilinmiyor; yeniden denemeden önce aynı sepet kimliğiyle sorgulanır.
    #[error("Fişin kesilip kesilmediği doğrulanamadı: {0}")]
    OutcomeUnknown(String),
    #[error("Yazar kasa işlemi reddetti (kod {code}): {message}")]
    Rejected { code: String, message: String },
    #[error("Yazar kasa şifreleme hatası: {0}")]
    Crypto(String),
    #[error("Yazar kasa fişi geçersiz: {0}")]
    Validation(String),
    #[error("Yazar kasa sertifikası doğrulanamadı: {0}")]
    CertificateUnverified(String),
    #[error("Yazar kasa ayarı geçersiz: {0}")]
    Settings(String),
}

impl OkcError {
    /// Arayüzün ayırt edebileceği kararlı kod; mesaj metni sözleşme değildir.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotConnected(_) => "OKC_NOT_CONNECTED",
            Self::NotPaired(_) => "OKC_NOT_PAIRED",
            Self::Transport(_) => "OKC_TRANSPORT",
            Self::Timeout => "OKC_TIMEOUT",
            Self::Protocol(_) => "OKC_PROTOCOL",
            Self::OutcomeUnknown(_) => "OKC_OUTCOME_UNKNOWN",
            Self::Rejected { .. } => "OKC_REJECTED",
            Self::Crypto(_) => "OKC_CRYPTO",
            Self::Validation(_) => "OKC_INVALID_RECEIPT",
            Self::CertificateUnverified(_) => "OKC_CERTIFICATE",
            Self::Settings(_) => "OKC_SETTINGS",
        }
    }

    /// Komut sınırında kullanılan metin: `KOD: açıklama`.
    pub fn to_command_error(&self) -> String {
        format!("{}: {}", self.code(), self)
    }
}

pub type OkcResult<T> = Result<T, OkcError>;

/// Ödeme türü. Veresiye bir tahsilat değildir; fiş kesilmez ve bu türe girmez.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TenderKind {
    Cash,
    Card,
    MealCard,
}

impl TenderKind {
    /// Kablo üzerindeki tek bayt değer (KASAM360 taslak kodu, üretici belirtimiyle değişir).
    pub fn wire_code(self) -> u8 {
        match self {
            Self::Cash => 1,
            Self::Card => 3,
            Self::MealCard => 7,
        }
    }

    pub fn from_wire(code: u8) -> OkcResult<Self> {
        match code {
            1 => Ok(Self::Cash),
            3 => Ok(Self::Card),
            7 => Ok(Self::MealCard),
            other => Err(OkcError::Protocol(format!(
                "bilinmeyen ödeme türü: {other}"
            ))),
        }
    }

    /// POS yöntem adını ödeme türüne çevirir. Bilinmeyen yöntem karta sayılmaz:
    /// yanlış kanala yazılan tutar mali belge ile kasa sayımını ayrıştırır.
    pub fn from_method(method: &str) -> OkcResult<Option<Self>> {
        match method.trim().to_uppercase().as_str() {
            "CASH" | "NAKIT" => Ok(Some(Self::Cash)),
            "CARD" | "KREDI_KARTI" | "CREDIT_CARD" => Ok(Some(Self::Card)),
            "MEAL_CARD" | "YEMEK_KARTI" => Ok(Some(Self::MealCard)),
            // Cari borca yazılır; mali belge ayrı süreçtir.
            "VERESIYE" => Ok(None),
            other => Err(OkcError::Validation(format!(
                "bilinmeyen ödeme yöntemi: {other}"
            ))),
        }
    }
}

/// Fişteki tek satır. `total_cents` satırın KDV dahil tutarıdır; birim fiyat
/// bölme yuvarlaması yaratmasın diye cihaza toplam olarak gider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptLine {
    pub name: String,
    /// Miktar binde birim: 1 adet = 1000.
    pub quantity_milli: i64,
    pub total_cents: i64,
    /// KDV oranı baz puan: yüzde 10 = 1000.
    pub tax_bp: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptPayment {
    pub kind: TenderKind,
    pub amount_cents: i64,
    /// Yemek kartı markası (`MULTINET` gibi); yalnız `TenderKind::MealCard` için anlamlıdır.
    pub provider: Option<String>,
}

/// Cihaza gönderilecek fiş taslağı. `basket_id` aynı tahsilatın yeniden
/// denemesinde değişmez; cihaz aynı kimliği ikinci kez fişe çevirmez.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptDraft {
    pub basket_id: String,
    pub lines: Vec<ReceiptLine>,
    pub discount_cents: i64,
    pub payments: Vec<ReceiptPayment>,
}

pub const MAX_LINES: usize = 200;
pub const MAX_NAME_CHARS: usize = 40;

impl ReceiptDraft {
    /// Taslağı doğrular ve beklenen genel toplamı (kuruş) döndürür.
    ///
    /// Neden POS tarafında da doğrulanır: cihaz toplamı reddetse bile hatalı
    /// taslak hiç gönderilmemeli; ödeme toplamı ile fiş toplamı eşit olmak zorundadır.
    pub fn validate(&self) -> OkcResult<i64> {
        let invalid = |message: &str| Err(OkcError::Validation(message.to_string()));
        if self.basket_id.is_empty()
            || self.basket_id.len() > 64
            || !self.basket_id.is_ascii()
            || self.basket_id.chars().any(|c| c.is_ascii_control())
        {
            return invalid("sepet kimliği 1-64 görünür ASCII karakter olmalıdır");
        }
        if self.lines.is_empty() || self.lines.len() > MAX_LINES {
            return invalid("fişte 1-200 kalem bulunmalıdır");
        }
        let mut gross: i64 = 0;
        for line in &self.lines {
            if line.name.trim().is_empty() || line.name.chars().count() > MAX_NAME_CHARS {
                return invalid("kalem adı 1-40 karakter olmalıdır");
            }
            // Cihazın karakter kümesinde olmayan ad fişe yanlış basılmasın diye baştan reddedilir.
            super::tlv::encode_text(&line.name)?;
            if line.quantity_milli <= 0 || line.quantity_milli > 999_999_999 {
                return invalid("kalem miktarı sıfırdan büyük olmalıdır");
            }
            if line.total_cents < 0 || line.total_cents > 999_999_999_999 {
                return invalid("kalem tutarı geçersiz");
            }
            if !(0..=10_000).contains(&line.tax_bp) {
                return invalid("KDV oranı 0-10000 baz puan aralığında olmalıdır");
            }
            gross = gross
                .checked_add(line.total_cents)
                .ok_or_else(|| OkcError::Validation("fiş toplamı taştı".to_string()))?;
        }
        if self.discount_cents < 0 || self.discount_cents >= gross {
            return invalid("indirim sıfırdan küçük olamaz ve fiş toplamına eşit olamaz");
        }
        let total = gross - self.discount_cents;
        if self.payments.is_empty() {
            return invalid("fişte en az bir ödeme bulunmalıdır");
        }
        let mut paid: i64 = 0;
        for payment in &self.payments {
            if payment.amount_cents <= 0 {
                return invalid("ödeme tutarı sıfırdan büyük olmalıdır");
            }
            paid = paid
                .checked_add(payment.amount_cents)
                .ok_or_else(|| OkcError::Validation("ödeme toplamı taştı".to_string()))?;
        }
        if paid != total {
            return Err(OkcError::Validation(format!(
                "ödeme toplamı {paid} kuruş, fiş toplamı {total} kuruş"
            )));
        }
        Ok(total)
    }
}

/// Cihazın kapattığı fişin kimlik bilgileri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FiscalReceipt {
    /// ÖKC mali uygulamasının ürettiği benzersiz numara (GMP-3 §6.1/2).
    pub unique_id: String,
    pub receipt_no: u32,
    pub z_no: u32,
    pub eku_no: u32,
    pub total_cents: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> ReceiptDraft {
        ReceiptDraft {
            basket_id: "txn_1".to_string(),
            lines: vec![ReceiptLine {
                name: "Çay".to_string(),
                quantity_milli: 2000,
                total_cents: 5000,
                tax_bp: 1000,
            }],
            discount_cents: 500,
            payments: vec![ReceiptPayment {
                kind: TenderKind::Cash,
                amount_cents: 4500,
                provider: None,
            }],
        }
    }

    #[test]
    fn valid_draft_returns_total() {
        assert_eq!(draft().validate(), Ok(4500));
    }

    #[test]
    fn payment_mismatch_is_rejected() {
        let mut d = draft();
        d.payments[0].amount_cents = 4499;
        assert!(matches!(d.validate(), Err(OkcError::Validation(_))));
    }

    #[test]
    fn negative_and_zero_values_are_rejected() {
        let mut d = draft();
        d.lines[0].quantity_milli = 0;
        assert!(d.validate().is_err());
        let mut d = draft();
        d.discount_cents = -1;
        assert!(d.validate().is_err());
        let mut d = draft();
        d.discount_cents = 5000;
        assert!(d.validate().is_err());
    }

    #[test]
    fn method_mapping_is_fail_closed() {
        assert_eq!(TenderKind::from_method("nakit"), Ok(Some(TenderKind::Cash)));
        assert_eq!(TenderKind::from_method("VERESIYE"), Ok(None));
        assert!(TenderKind::from_method("CRYPTO").is_err());
    }
}
