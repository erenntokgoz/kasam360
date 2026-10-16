//! Dış aktör Tauri komutları (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar (§3.3). Bu modül
//! mantıksal alt modüllere bölünmüştür (`helpers`, `qr`, `ops`). Burada
//! `pub use` ile eski yollar korunur, böylece `tauri::generate_handler!`
//! ve harici çağıranlar etkilenmez.

pub(crate) mod helpers;
pub mod ops;
pub mod qr;

pub use ops::*;
pub use qr::*;
