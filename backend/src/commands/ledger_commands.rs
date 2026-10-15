//! Finans & Cari Defteri dış yüzeyi (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar. Bu dosya artık yalnızca
//! alt modülleri tanımlar ve `pub use` ile eski isimleri korur; böylece
//! `crate::ledger_commands::*` ve `tauri::generate_handler!` yolları değişmez.

pub mod budget;
pub mod debts;
pub mod directories;
pub mod expenses;
pub mod financial_report;
pub mod guard;
pub mod net_balance;
pub mod owner_personal;
pub mod statement;

pub use budget::*;
pub use debts::*;
pub use directories::*;
pub use expenses::*;
pub use financial_report::*;
pub use net_balance::*;
pub use owner_personal::*;
pub use statement::*;

#[cfg(test)]
#[path = "ledger_commands/security_tests.rs"]
mod security_tests;
