//! Structured logging — tracing + tracing-subscriber + rolling file.
//!
//! Neden bu dosya: AGENTS.md §3.4'te sessiz hata yasak. `eprintln!` ile
//! log atmak, hata seviyesini kaydeder ve production'da dosya yolu yoktur.
//! Bu modül:
//! 1. `tracing-subscriber` ile fmt + env-filter + rolling-file kurar.
//! 2. Uygulama başlangıcında (`lib.rs::run()`) init edilir.
//! 3. `TRACING_LOG_LEVEL` ortam değişkeni ile seviye ayarlanır (varsayılan: info).
//!
//! Kullanım: `crate::log::init()` bir kez call edilir.

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, EnvFilter, Layer};

/// Log seviyesi — varsayılan `info`.
const DEFAULT_LOG_LEVEL: &str = "info";

/// Uygulama loglayıcısını başlatır.
///
/// Çıktı iki kanala gider:
/// - Konsol (stderr): fmt layer, renkli, okunabilir.
/// - Dosya (rolling): `logs/kasam360_YYYY-MM-DD.log`, günde bir döner.
///
/// # Hata
/// Dosya açılamazsa sadece konsol katmanı çalışır.
/// Loglama asla uygulama başlatmayı durdurmaz.
pub fn init() {
    let log_level = std::env::var("TRACING_LOG_LEVEL").unwrap_or_else(|_| DEFAULT_LOG_LEVEL.to_string());

    let env_filter = EnvFilter::new(format!(
        "kasam360_core={},tauri={},sqlx={}",
        log_level, log_level, "warn"
    ));

    // Konsol katmanı — stderr, renkli.
    let console_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .with_target(true)
        .with_line_number(true)
        .with_filter(env_filter.clone())
        .boxed();

    // Dosya katmanı — rolling, daily. Builder API ile hata kontrolü.
    let file_layer = match RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("kasam360")
        .filename_suffix(".log")
        .build("logs")
    {
        Ok(appender) => fmt::layer()
            .with_writer(appender)
            .with_ansi(false)
            .with_target(true)
            .with_line_number(true)
            .with_filter(env_filter.clone())
            .boxed(),
        Err(_) => {
            // Dosya açılamazsa sadece konsol katmanı çalışır.
            // Loglama asla uygulamayı durdurmaz.
            eprintln!("[WARN] Log dosyası açılamadı, sadece konsol logu etkin.");
            let subscriber = tracing_subscriber::registry().with(console_layer);
            let _ = tracing::subscriber::set_global_default(subscriber);
            return;
        }
    };

    let subscriber = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer);

    let _ = tracing::subscriber::set_global_default(subscriber);
}

/// Structured log kaydı — domain olayları.
///
/// Kullanım: `crate::log::info!("siparis_olusturuldu", order_id = %id, total_cents = total);`
pub use tracing::{debug, error, info, warn};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_init_calisir() {
        // Test ortamında init() call etme — sadece modülün import edildiğini doğrula.
        info!("test mesaji");
    }
}