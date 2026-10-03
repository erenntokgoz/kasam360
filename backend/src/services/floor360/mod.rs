//! Faz 13 · Kroki düzen servisi.
//!
//! Katmanlar:
//! - `types`    → sözleşme + doğrulama kuralları (tek doğruluk kaynağı)
//! - `templates`→ dört hazır şablonun sabit verisi
//! - `layout`   → okuma, düzen yazımı, bölüm yaşam döngüsü
//! - `objects`  → mimari obje yaşam döngüsü + şablon uygulaması

pub mod layout;
pub mod objects;
pub mod templates;
pub mod types;

#[cfg(test)]
mod tests;
