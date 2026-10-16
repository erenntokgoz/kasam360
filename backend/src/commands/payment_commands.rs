//! Ödeme komutları (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar (§3.3). Bu modül
//! mantıksal alt modüllere bölünmüştür (`types`, `single`, `split`, `refund`).
//! Burada `pub use` ile eski yollar korunur, böylece `tauri::generate_handler!`
//! ve harici çağıranlar etkilenmez.

pub mod refund;
pub mod single;
pub mod split;
pub mod types;

pub use refund::*;
pub use single::*;
pub use split::*;
pub use types::*;
