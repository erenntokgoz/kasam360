//! Satış mesajları: fiş başlat, kalem, ödeme, kapat, iptal, sorgu.
//!
//! DOĞRULANMADI: GİB belgesi (GMP-3 sürüm 5.0) yalnız eşleşme ve EFT-POS
//! mesajlarını tanımlar; satış uygulamasının fişi ÖKC'de nasıl başlatıp
//! kapatacağı üreticiye özeldir (belge §2.1, §6.1: akış ve benzersiz numara
//! ilkesi vardır, mesaj düzeni yoktur). Buradaki mesaj tipleri (`FF8A80..85`) ve
//! `DF30` özel veri grubundaki etiketler (`DFB010..`) KASAM360 taslağıdır; belgenin
//! "protokol genişletilebilir" kuralı (§2.11) içinde kalır ve üretici belirtimi
//! gelince ilgili kart adaptöründe değiştirilecektir.

use super::frame::{Gmp3Message, GROUP_BANK, GROUP_PRIVATE};
use super::session::OkcClient;
use super::tlv::{bcd_decode, bcd_encode, decode_text, encode_text};
use super::types::{FiscalReceipt, OkcError, OkcResult, ReceiptDraft};

pub const MSG_BEGIN_REQ: u32 = 0xFF8A80;
pub const MSG_ITEM_REQ: u32 = 0xFF8A81;
pub const MSG_PAYMENT_REQ: u32 = 0xFF8A82;
pub const MSG_CLOSE_RECEIPT_REQ: u32 = 0xFF8A83;
pub const MSG_ABORT_REQ: u32 = 0xFF8A84;
pub const MSG_QUERY_REQ: u32 = 0xFF8A85;

pub const TAG_BASKET_ID: u32 = 0xDFB010;
pub const TAG_UNIQUE_ID: u32 = 0xDFB011;
pub const TAG_ITEM_NAME: u32 = 0xDFB012;
pub const TAG_QUANTITY: u32 = 0xDFB013;
pub const TAG_TAX_BP: u32 = 0xDFB014;
pub const TAG_TENDER: u32 = 0xDFB015;
pub const TAG_LINE_NO: u32 = 0xDFB016;
pub const TAG_STATE: u32 = 0xDFB017;

/// Tutar etiketleri bankacılık grubundadır (belge §4.3: tutar kritik veridir).
pub const TAG_AMOUNT: u32 = 0xDFEE0E;
pub const TAG_DISCOUNT: u32 = 0xDFEE18;
pub const TAG_Z_NO: u32 = 0xDFEE5A;
pub const TAG_RECEIPT_NO: u32 = 0xDFEE5B;
pub const TAG_EKU_NO: u32 = 0xDFEE5C;

/// Sepetin cihazdaki durumu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BasketState {
    Unknown,
    Open,
    Closed,
    Aborted,
}

impl BasketState {
    pub fn wire_code(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Open => 1,
            Self::Closed => 2,
            Self::Aborted => 3,
        }
    }

    fn from_wire(code: u8) -> OkcResult<Self> {
        match code {
            0 => Ok(Self::Unknown),
            1 => Ok(Self::Open),
            2 => Ok(Self::Closed),
            3 => Ok(Self::Aborted),
            other => Err(OkcError::Protocol(format!(
                "bilinmeyen sepet durumu: {other}"
            ))),
        }
    }
}

/// Sorgu cevabı; kapalıysa fiş bilgileri de gelir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasketStatus {
    pub state: BasketState,
    /// Açık veya kapalı sepetin benzersiz numarası.
    pub unique_id: Option<String>,
    pub receipt: Option<FiscalReceipt>,
}

fn amount_field(cents: i64) -> OkcResult<Vec<u8>> {
    let value = u64::try_from(cents)
        .map_err(|_| OkcError::Validation("tutar negatif olamaz".to_string()))?;
    bcd_encode(value, 6)
}

fn read_amount(message: &Gmp3Message, tag: u32) -> OkcResult<i64> {
    i64::try_from(bcd_decode(message.require(GROUP_BANK, tag)?)?)
        .map_err(|_| OkcError::Protocol("tutar taştı".to_string()))
}

fn read_u32(message: &Gmp3Message, tag: u32) -> OkcResult<u32> {
    u32::try_from(bcd_decode(message.require(GROUP_BANK, tag)?)?)
        .map_err(|_| OkcError::Protocol("numara taştı".to_string()))
}

fn read_unique_id(message: &Gmp3Message) -> OkcResult<String> {
    let id = decode_text(message.require(GROUP_PRIVATE, TAG_UNIQUE_ID)?);
    if id.is_empty() {
        return Err(OkcError::Protocol("benzersiz numara boş".to_string()));
    }
    Ok(id)
}

/// Kapalı fişin bilgilerini cevaptan okur.
pub fn read_receipt(message: &Gmp3Message) -> OkcResult<FiscalReceipt> {
    Ok(FiscalReceipt {
        unique_id: read_unique_id(message)?,
        receipt_no: read_u32(message, TAG_RECEIPT_NO)?,
        z_no: read_u32(message, TAG_Z_NO)?,
        eku_no: read_u32(message, TAG_EKU_NO)?,
        total_cents: read_amount(message, TAG_AMOUNT)?,
    })
}

impl OkcClient {
    fn unique_request(&mut self, msg_type: u32, unique_id: &str) -> OkcResult<Gmp3Message> {
        Ok(self.request(msg_type)?.with_field(
            GROUP_PRIVATE,
            TAG_UNIQUE_ID,
            encode_text(unique_id)?,
        ))
    }

    /// Sepet kimliğinin cihazdaki durumunu sorar. Yeniden denemelerde ve
    /// belirsiz sonuçlarda ilk bakılan yerdir: fiş zaten kesildiyse ikinci fiş kesilmez.
    pub fn query_basket(&mut self, basket_id: &str) -> OkcResult<BasketStatus> {
        let request = self.request(MSG_QUERY_REQ)?.with_field(
            GROUP_PRIVATE,
            TAG_BASKET_ID,
            encode_text(basket_id)?,
        );
        let response = self.exchange(request)?;
        let state = BasketState::from_wire(
            *response
                .require(GROUP_PRIVATE, TAG_STATE)?
                .first()
                .ok_or_else(|| OkcError::Protocol("sepet durumu boş".to_string()))?,
        )?;
        let receipt = if state == BasketState::Closed {
            Some(read_receipt(&response)?)
        } else {
            None
        };
        let unique_id = match state {
            BasketState::Open | BasketState::Closed => Some(read_unique_id(&response)?),
            _ => None,
        };
        Ok(BasketStatus {
            state,
            unique_id,
            receipt,
        })
    }

    /// Açık fişi iptal eder. Kapanmış fişin iptali/iadesi ayrı mali süreçtir ve
    /// burada yoktur.
    pub fn abort_receipt(&mut self, unique_id: &str) -> OkcResult<()> {
        let request = self.unique_request(MSG_ABORT_REQ, unique_id)?;
        self.exchange(request).map(|_| ())
    }

    /// Fişi uçtan uca keser: başlat, kalemler, ödemeler, kapat.
    ///
    /// Güvenlik sırası: taslak yerelde doğrulanır; cihazda aynı sepet kimliği
    /// zaten kapalıysa o fiş döner (ikinci fiş kesilmez); açık kalmış eski deneme
    /// iptal edilir. Kapanış cevabı gelmezse sonuç bilinmiyor sayılır ve sepet
    /// yeniden sorgulanır; hâlâ belirsizse `OutcomeUnknown` döner.
    pub fn issue_receipt(&mut self, draft: &ReceiptDraft) -> OkcResult<FiscalReceipt> {
        let total = draft.validate()?;
        self.require_paired()?;

        let status = self.query_basket(&draft.basket_id)?;
        match (status.state, status.receipt, status.unique_id) {
            (BasketState::Closed, Some(receipt), _) => {
                if receipt.total_cents != total {
                    return Err(OkcError::Validation(format!(
                        "sepet {} zaten {} kuruşla kapatılmış; yeni tutar {total}",
                        draft.basket_id, receipt.total_cents
                    )));
                }
                return Ok(receipt);
            }
            (BasketState::Open, _, Some(open_id)) => {
                // Önceki deneme yarıda kalmış: kalan kalemler tekrar eklenmesin diye
                // cihazdaki açık fiş iptal edilip baştan başlanır.
                self.abort_receipt(&open_id)?;
            }
            _ => {}
        }

        let begin = self.request(MSG_BEGIN_REQ)?.with_field(
            GROUP_PRIVATE,
            TAG_BASKET_ID,
            encode_text(&draft.basket_id)?,
        );
        let unique_id = read_unique_id(&self.exchange(begin)?)?;

        match self.fill_and_close(draft, &unique_id, total) {
            Ok(receipt) => Ok(receipt),
            Err(error @ (OkcError::Timeout | OkcError::Transport(_))) => {
                self.resolve_unknown(&draft.basket_id, total, error)
            }
            Err(error) => {
                // Cihaz reddettiyse açık fiş bırakılmaz; iptal de başarısız olursa
                // asıl hata önde tutulur, açık fiş bir sonraki denemede iptal edilir.
                let _ = self.abort_receipt(&unique_id);
                Err(error)
            }
        }
    }

    fn fill_and_close(
        &mut self,
        draft: &ReceiptDraft,
        unique_id: &str,
        total: i64,
    ) -> OkcResult<FiscalReceipt> {
        for (index, line) in draft.lines.iter().enumerate() {
            let line_no = u64::try_from(index + 1)
                .map_err(|_| OkcError::Validation("kalem sırası taştı".to_string()))?;
            let quantity = u64::try_from(line.quantity_milli)
                .map_err(|_| OkcError::Validation("miktar negatif olamaz".to_string()))?;
            let tax = u64::try_from(line.tax_bp)
                .map_err(|_| OkcError::Validation("KDV oranı negatif olamaz".to_string()))?;
            let request = self
                .unique_request(MSG_ITEM_REQ, unique_id)?
                .with_field(GROUP_PRIVATE, TAG_LINE_NO, bcd_encode(line_no, 2)?)
                .with_field(GROUP_PRIVATE, TAG_ITEM_NAME, encode_text(&line.name)?)
                .with_field(GROUP_PRIVATE, TAG_QUANTITY, bcd_encode(quantity, 6)?)
                .with_field(GROUP_PRIVATE, TAG_TAX_BP, bcd_encode(tax, 2)?)
                .with_field(GROUP_BANK, TAG_AMOUNT, amount_field(line.total_cents)?);
            self.exchange(request)?;
        }
        for payment in &draft.payments {
            let request = self
                .unique_request(MSG_PAYMENT_REQ, unique_id)?
                .with_field(GROUP_PRIVATE, TAG_TENDER, vec![payment.kind.wire_code()])
                .with_field(GROUP_BANK, TAG_AMOUNT, amount_field(payment.amount_cents)?);
            self.exchange(request)?;
        }
        // Kapanışta beklenen toplam ve indirim gönderilir; cihaz kendi hesabıyla
        // uyuşmazsa fişi kapatmaz (iki taraflı kuruş kontrolü).
        let close = self
            .unique_request(MSG_CLOSE_RECEIPT_REQ, unique_id)?
            .with_field(GROUP_BANK, TAG_AMOUNT, amount_field(total)?)
            .with_field(
                GROUP_BANK,
                TAG_DISCOUNT,
                amount_field(draft.discount_cents)?,
            );
        let response = self.exchange(close)?;
        let receipt = read_receipt(&response)?;
        if receipt.total_cents != total {
            return Err(OkcError::Protocol(format!(
                "cihaz {} kuruşla kapattı, beklenen {total}",
                receipt.total_cents
            )));
        }
        Ok(receipt)
    }

    /// Cevap alınamadığında sepeti sorgular: kapalıysa başarıdır, açık veya
    /// bilinmiyorsa sonuç belirsizdir ve kasiyer cihazı kontrol etmelidir.
    fn resolve_unknown(
        &mut self,
        basket_id: &str,
        total: i64,
        cause: OkcError,
    ) -> OkcResult<FiscalReceipt> {
        match self.query_basket(basket_id) {
            Ok(BasketStatus {
                state: BasketState::Closed,
                receipt: Some(receipt),
                ..
            }) if receipt.total_cents == total => Ok(receipt),
            _ => Err(OkcError::OutcomeUnknown(format!(
                "sepet {basket_id}: {cause}"
            ))),
        }
    }
}
