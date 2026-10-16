//! POS komutları (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar (§3.3). Bu modül
//! mantıksal alt modüllere bölünmüştür (`catalog`, `order`, `queries`). Burada
//! `pub use` ile eski yollar korunur, böylece `tauri::generate_handler!`
//! ve harici çağıranlar etkilenmez.

pub mod catalog;
pub mod order;
pub mod queries;

pub use catalog::*;
pub use order::*;
pub use queries::*;
