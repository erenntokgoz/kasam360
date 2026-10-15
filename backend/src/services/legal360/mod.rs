//! Yasal takvim, kampanya, sigorta, telif ve e-Arşiv servisleri.
//!
//! Bu katman komutlardan bağımsızdır: iş mantığı burada yaşar, Tauri komutu
//! yalnız yetki sınayıp buraya delegasyon yapar. Böylece her kural Tauri
//! runtime olmadan testlenebilir ve yetki değişikliği tek yerde kalır.
//!
//! Beş kural tüm alt modüllerde aynıdır:
//!   1. Her `SELECT`, `UPDATE` ve `DELETE` `tenant_id` ile filtrelenir.
//!   2. Para okuması `try_get(...)?` ile yükseltilir; `unwrap_or(0)` yok.
//!   3. Tarihler `YYYY-AA-GG` metnidir; karşılaştırma sözlükseldir.
//!   4. Silme yoktur; `is_active` ile soft-delete uygulanır.
//!   5. Doğrulama `Err` döner; geçersiz girdi varsayılana sessizce çevrilmez.

pub mod campaigns;
pub mod e_invoice;
pub mod insurance;
pub mod legal;
pub mod music_license;
pub mod special_days;

pub use campaigns::{
    apply_campaign, campaign_stats, list_campaign_templates, list_campaigns, parse_campaign_rule,
    save_campaign, AppliedCampaign, Campaign, CampaignInput, CampaignRule, CampaignStats,
};
pub use e_invoice::{
    cancel_e_invoice, generate_e_invoice, get_e_invoice, list_e_invoices, mark_e_invoice_accepted,
    mark_e_invoice_rejected, mark_e_invoice_sent, EInvoice, EInvoiceInput,
};
pub use insurance::{
    get_expiring_policies, list_policies, save_policy, InsurancePolicy, PolicyInput,
};
pub use legal::{
    get_expiring_documents, list_documents, list_upcoming_reminders, save_document, LegalDocument,
    LegalDocumentInput,
};
pub use music_license::{
    get_expiring_licenses, list_licenses, save_license, MusicLicense, MusicLicenseInput,
};
pub use special_days::{
    list_special_days, list_upcoming_special_days, save_special_day, SpecialDay, SpecialDayInput,
};

use sqlx::sqlite::SqliteRow;
use sqlx::Row;

/// Nullable metin kolonunu güvenli okur; boş metin `None` olur.
///
/// Neden ayrı yordam: `sqlx::query_scalar::<Option<String>>(...)` +
/// `fetch_optional` bir NULL kolonu `None` verir ama `""` ile `NULL` ayırt
/// edilemez. Kullanıcı "hatırlatma süresi boş" dediğinde ekranda 0 değil
/// "belirtilmedi" görünmelidir.
pub(crate) fn metin_al(row: &SqliteRow, kolon: &str) -> Result<Option<String>, String> {
    let deger: Option<String> = row.try_get(kolon).map_err(|e| e.to_string())?;
    Ok(deger.filter(|m| !m.trim().is_empty()))
}

/// Nullable tam sayı kolonunu güvenli okur.
///
/// Bu yordam AGENTS.md §3.4'ün somut karşılığıdır: `unwrap_or(0)` yazmak
/// "teminat bilinmiyor"yu "teminat yok"a çevirir ve poliçe raporu yanlış
/// güvence gösterir. Burada NULL kalır.
pub(crate) fn tam_sayi_al(row: &SqliteRow, kolon: &str) -> Result<Option<i64>, String> {
    row.try_get::<Option<i64>, _>(kolon)
        .map_err(|e| e.to_string())
}

/// Boolean kolonu okur. SQLite'ta INTEGER 0/1 saklanır; bozuk değer `Err`
/// verir, `true`'ya çevrilmez.
pub(crate) fn bayrak_al(row: &SqliteRow, kolon: &str) -> Result<bool, String> {
    let deger: i64 = row.try_get(kolon).map_err(|e| e.to_string())?;
    Ok(deger != 0)
}

/// Bugünün tarihi, `YYYY-AA-GG`.
///
/// Neden UTC değil yerel: işletme takvimi yerel güne göre işler. Kapanış
/// saati 23:59'da olduğuna göre UTC gün sınırı bir işletmenin gününü iki saat
/// kaydırabilir.
pub(crate) fn bugun() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Bugünden `gun` gün sonrası/öncesi, `YYYY-AA-GG`.
pub(crate) fn gun_kaydir(gun: i64) -> String {
    (chrono::Local::now().date_naive() + chrono::Duration::days(gun))
        .format("%Y-%m-%d")
        .to_string()
}

/// Tarih metninin biçimini doğrular.
///
/// Neden ayrı doğrulama: `expiry_date` sözlüksel karşılaştırılır. Geçersiz
/// metin ("31.02.2026") sessizce çok büyük bir tarih gibi sıralanır ve belge
/// "bitmemiş" görünür. Tarihi çözebiliyorsak biçim doğrudur.
pub(crate) fn tarih_dogrula(etiket: &str, deger: &str) -> Result<(), String> {
    let metin = deger.trim();
    if metin.len() != 10 {
        return Err(format!("VALIDATION: {etiket} YYYY-AA-GG biçiminde olmalı"));
    }
    chrono::NaiveDate::parse_from_str(metin, "%Y-%m-%d")
        .map_err(|_| format!("VALIDATION: {etiket} geçerli bir tarih değil: {metin}"))?;
    Ok(())
}

/// `HH:MM` saat metnini doğrular. Kampanya saat aralığı bu biçimdedir.
pub(crate) fn saat_dogrula(etiket: &str, deger: &str) -> Result<(), String> {
    let metin = deger.trim();
    if chrono::NaiveTime::parse_from_str(metin, "%H:%M").is_err() {
        return Err(format!(
            "VALIDATION: {etiket} SS:DD biçiminde olmalı: {metin}"
        ));
    }
    Ok(())
}

/// Hatırlatma gün sayısını doğrular.
///
/// Üst sınır 365: iki yıllık hatırlatma "bu yıl" değildir ve filtreyi
/// anlamsızlaştırır. Alt sınır 0: bugün dolan belge bugün uyarısı almalıdır.
pub(crate) fn hatirlatma_dogrula(gun: i64) -> Result<(), String> {
    if !(0..=365).contains(&gun) {
        return Err("VALIDATION: hatırlatma süresi 0-365 gün arasında olmalı".into());
    }
    Ok(())
}

/// Negatif olmayan tutar doğrulaması.
///
/// Negatif prim, negatif telif veya negatif KDV "para ödemedim" değil,
/// "bana para ödediler" anlamına gelir; her ikisi de mali tabloyu bozar.
pub(crate) fn tutar_dogrula(etiket: &str, deger: Option<i64>) -> Result<(), String> {
    if let Some(tutar) = deger {
        if tutar < 0 {
            return Err(format!("VALIDATION: {etiket} negatif olamaz"));
        }
    }
    Ok(())
}
