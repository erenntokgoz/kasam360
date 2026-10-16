//! Platform yönetimi komutları (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar (§3.3). Bu modül
//! mantıksal alt modüllere bölünmüştür (`tenants`, `admin_ops`, `devices`,
//! `master_vault_commands`). Burada `pub use` ile eski yollar korunur,
//! böylece `tauri::generate_handler!` satırları ve `crate::commands::platform_commands::*`
//! çağıranları değişmez.

pub mod admin_ops;
pub mod devices;
pub mod master_vault_commands;
pub mod tenants;

pub use admin_ops::*;
pub use devices::*;
pub use master_vault_commands::*;
pub use tenants::*;

/// Platform seviyesindeki (çapraz tenant) denetim kayıtlarının taşındığı
/// ayrılmış platform ad alanı. MASTER'ın kendi işletmesi yoktur; platform
/// kayıtları işletme kiracılarıyla aynı ad alanını paylaşırsa bir
/// işletmenin denetim defterine karışırdı (AGENTS.md §2.7).
pub const PLATFORM_AUDIT_TENANT: &str = "PLATFORM";
