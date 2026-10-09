//! Domain katmanı — iş kuralları ve newtype'lar.
//!
//! Neden ayrı katman: `services` altyapı
//! (denetim, harici uçlar) taşırken, saf iş
//! kavramları (para, oran) bağımsız modüllerde
//! yaşar; `db` ve `commands` onları kullanır.

pub mod error;
pub mod money;

/// Domain hata tipini dışa aktar.
pub use error::DomainError;
