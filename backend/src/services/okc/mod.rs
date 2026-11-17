//! Yeni Nesil ÖKC (yazar kasa) entegrasyon altyapısı: GİB GMP-3 sürüm 5.0.
//!
//! Katmanlar: `tlv` (kodlama) -> `frame` (paket) -> `transport` (seri/USB/TCP) ->
//! `session` (istek-cevap) -> `pairing` (eşleşme) -> `sale` (fiş akışı). Veritabanı
//! tarafı `settings` ve `gate` içindedir. Gerçek cihazla SINANMADI; kapsam,
//! varsayımlar ve eksikler docs/contracts/okc-gmp3.md içindedir.
//!
//! Kablosuz bağlantı bilerek desteklenmez (belge §2.2, §5.3): taşıma türleri
//! yalnız seri, USB (sanal seri) ve Ethernet'tir.

pub mod crypto;
pub mod frame;
pub mod gate;
pub mod pairing;
pub mod receipt_draft;
pub mod receipt_log;
pub mod sale;
pub mod session;
pub mod settings;
#[cfg(any(test, debug_assertions))]
pub mod simulator;
#[cfg(any(test, debug_assertions))]
mod simulator_sale;
pub mod tlv;
pub mod transport;
pub mod types;

#[cfg(test)]
mod gate_tests;
#[cfg(test)]
mod protocol_tests;
