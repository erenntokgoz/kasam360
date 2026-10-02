//! Finans & Cari Defteri dış yüzeyi (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar. Bu dosya artık yalnızca
//! alt modülleri tanımlar ve `pub use` ile eski isimleri korur; böylece
//! `crate::ledger_commands::*` ve `tauri::generate_handler!` yolları değişmez.

pub mod budget;
pub mod debts;
pub mod financial_report;
pub mod owner_personal;
pub mod statement;
pub mod directories;
pub mod expenses;
pub mod guard;
pub mod net_balance;

pub use budget::*;
pub use debts::*;
pub use financial_report::*;
pub use owner_personal::*;
pub use statement::*;
pub use directories::*;
pub use expenses::*;
pub use net_balance::*;

#[cfg(test)]
#[path = "ledger_commands/security_tests.rs"]
mod security_tests;