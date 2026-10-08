//! Faz 16 — dış aktör servisi.
//!
//! Erişim modeli kararı (C-8): dış aktörler **ağa çıkmaz**, takas dosya
//! üzerinden yapılır. Gerekçe `migrations/schema.sql` içindeki Faz 16 başlığında.
//!
//! Katman sözleşmesi: bu modül iş mantığı taşır ve yalnız `&mut SqliteConnection`
//! alır; Tauri `State` taşımadığı için test edilebilir. Komut katmanı yalnız yetki
//! sınar ve buraya delegasyon yapar (bkz. `commands/mod.rs` sözlüğü).
//!
//! Alt modüller:
//!   * `signing`   — dışa aktarım/import HMAC imzası
//!   * `qr_menu`   — müşteri oturumu, QR menü dosyası, müşteri talebi, geri bildirim
//!   * `supplier`  — tedarikçiye giden talep
//!   * `accountant`— mali müşavir dönem raporu
//!   * `tickets`   — teknik servis kaydı
//!   * `queues`    — WhatsApp / e-posta kuyrukları ve sahte sağlayıcılar

pub mod accountant;
pub mod menu_file;
pub mod qr_menu;
pub mod queues;
pub mod signing;
pub mod supplier;
pub mod tickets;

/// Çağıranın işletmesini fail-closed doğrular.
///
    /// Neden varsayılan kiracıya düşmek yasak: dış aktör tabloları çok kiracılıdır ve
/// düşen kiracı, "hiçbir işletmenin verisi" yerine **bir** işletmenin verisini
/// getirir. B1'de her tablo `tenant_id` zorunlu; buradaki kural o zorunluluğun
/// tek giriş noktasıdır.
pub fn tenant_zorunlu(tenant_id: Option<&str>) -> Result<String, String> {
    let kiraci = tenant_id.unwrap_or("").trim();
    if kiraci.is_empty() {
        return Err("TENANT_REQUIRED: İşletme belirtilmedi.".to_string());
    }
    Ok(kiraci.to_string())
}
