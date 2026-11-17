//! Termal basım komutları için tarih, tutar ve yetki yardımcıları.
//!
//! Neden ayrı modül: print_commands.rs 500 satır tavanını aştığı için
//! ortak SQL sabitleri ve biçimlendiriciler bu alt modüle ayrıldı.

use std::time::Duration;

use crate::rbac::{self, Role};

/// Basım süreci takılırsa kasa akışı beklemesin.
const PRINT_TIMEOUT: Duration = Duration::from_secs(20);

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

/// Metni Windows yazıcı kuyruğuna verir. `None` ise Windows varsayılan yazıcısı kullanılır (müşteri fişleri). Yazıcı adı ortam değişkeniyle gider; komut
/// metnine karışmaz, bu yüzden adındaki tırnak komutu bozamaz.
pub(crate) async fn send_to_printer(printer: Option<&str>, text: String) -> Result<(), String> {
    let printer = printer.map(str::to_string);
    let job = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[Console]::InputEncoding=[Text.Encoding]::UTF8; if ($env:KASAM_PRINTER) { $input | Out-Printer -Name $env:KASAM_PRINTER } else { $input | Out-Printer }",
            ])
            .env("KASAM_PRINTER", printer.unwrap_or_default())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("yazıcı komutu başlatılamadı: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("fiş yazıcıya iletilemedi: {e}"))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|e| format!("yazıcı yanıt vermedi: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    });
    match tokio::time::timeout(PRINT_TIMEOUT, job).await {
        Err(_) => Err("yazıcı zaman aşımına uğradı".to_string()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(result)) => result,
    }
}
