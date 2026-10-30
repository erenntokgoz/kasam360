//! Cari hesap işlemleri.
//!
//! Her yazma, kimlikleri ve zamanı önceden belirlenmiş tek bir [`CariOp`]
//! değeridir. Neden: aynı işlem kaynak cihazda ve eşitlemede diğer cihazlarda
//! bire bir aynı satırları üretmelidir; `apply` içinde kimlik ya da saat
//! üretilirse cihazlar ayrışır.

pub mod ops;
pub mod payment;
pub mod search;
pub mod supplier_document;

pub use ops::{apply, CardFields, CariOp, OpenDebtInput};
pub use payment::RecordPaymentInput;
pub use supplier_document::{awaiting_documents, ApproveDocumentInput, AwaitingDocument};

/// İşlemin neden uygulanmadığını ayırır.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplyError {
    /// İş kuralı reddetti; aynı durumda her cihazda aynı sonuç çıkar ve kalıcıdır.
    Rejected(String),
    /// Altyapı hatası; işlem yazılmadı, aynı kimlikle yeniden denenebilir.
    Internal(String),
}

impl From<sqlx::Error> for ApplyError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.to_string())
    }
}

impl From<ApplyError> for String {
    fn from(error: ApplyError) -> Self {
        match error {
            ApplyError::Rejected(message) | ApplyError::Internal(message) => message,
        }
    }
}

#[cfg(test)]
mod tests;
