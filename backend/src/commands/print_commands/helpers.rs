//! Termal basım komutları için tarih, tutar ve yetki yardımcıları.
//!
//! Neden ayrı modül: print_commands.rs 500 satır tavanını aştığı için
//! ortak SQL sabitleri ve biçimlendiriciler bu alt modüle ayrıldı.

use crate::rbac::{self, Role};

/// Bugünün **yerel** tarihi (SQL ifadesi).
pub(crate) const BUGUN_SQL: &str = "date('now', 'localtime')";

/// İş gününün **UTC karşılığı** olan yerel gün başı (SQL ifadesi).
pub(crate) const GUN_BASI_SQL: &str = "datetime('now', 'localtime', 'start of day', 'utc')";

/// Veritabanında UTC saklanan zaman damgasını yerel okunur biçime çevirir.
pub(crate) fn utc_yerel_goster(metin: &str) -> String {
    let ayrik = metin.trim();
    if let Ok(an) = chrono::NaiveDateTime::parse_from_str(ayrik, "%Y-%m-%d %H:%M:%S") {
        return an
            .and_utc()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
    }
    if let Ok(an) = chrono::DateTime::parse_from_rfc3339(ayrik) {
        return an
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
    }
    ayrik.to_string()
}

/// Kuruşu tam sayıdan biçimlendirir; float aritmetiği kullanılmaz.
pub(crate) fn fmt_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = if cents < 0 { -cents } else { cents };
    format!("{}{},{:02} TL", sign, absolute / 100, absolute % 100)
}

pub(crate) fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

/// Fiş basımı yapabilecek roller.
pub(crate) fn require_receipt_printer(role: Option<&str>) -> Result<(), String> {
    rbac::require_any_present(role, &[Role::Owner, Role::Manager, Role::Cashier])?;
    Ok(())
}
