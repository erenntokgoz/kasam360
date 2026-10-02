//! Personel 360° servisleri — ortak yardımcılar ve alt modüller.
//!
//! Dosya 500 satır sınırını aşmasın diye alan alana bölündü. `pub use`
//! yeniden dışa aktarımı sayesinde `staff_service::list_profiles` gibi
//! mevcut çağrı yolları bozulmaz.
//!
//! Finansal kural (AGENTS.md §3.4): maaş/prim/bahşiş okumalarında hata yukarı
//! taşınır, sıfıra dönüştürülmez. Tüm sorgular `tenant_id` ile filtrelenir.

// Alt modüller `staff_service/` klasöründe durur; dosya modülü olduğu için
// yol Rust'un varsayılan kuralından (`staff_service/*.rs`) farklıdır.
#[path = "staff_service/custody.rs"]
pub mod custody;
#[path = "staff_service/incident.rs"]
pub mod incident;
#[path = "staff_service/leave.rs"]
pub mod leave;
#[path = "staff_service/profile.rs"]
pub mod profile;
#[path = "staff_service/shift_plan.rs"]
pub mod shift_plan;

pub use custody::{add_custody, list_custody, return_custody};
pub use incident::{list_incidents, record_incident};
pub use leave::{decide_leave, list_leaves, request_leave};
pub use profile::{list_profiles, upcoming_birthdays, upsert_profile};
pub use shift_plan::{add_shift_plan, list_shift_plans};

use chrono::NaiveDate;
use sqlx::{Row, sqlite::SqliteRow};

/// `YYYY-MM-DD` biçimini doğrular. Gerçek tarih mi diye de kontrol eder:
/// `2026-02-30` biçim olarak geçerli ama takvimde yoktur.
pub(crate) fn is_iso_date(raw: &str) -> bool {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").is_ok()
}

/// Tutar kolonunu yetkiye göre okur.
///
/// Yetki yoksa kolona hiç dokunulmaz; sıfıra çevrilmez. Yetki varsa hata
/// `?` ile yükseltilir (AGENTS.md §3.4). `Option<i64>` okunur: maaş kolonu
/// nullable'dır ve `NULL` = "henüz belirlenmedi".
pub(crate) fn read_amount(
    row: &SqliteRow,
    column: &str,
    can_view: bool,
) -> Result<Option<i64>, String> {
    if !can_view {
        return Ok(None);
    }
    row.try_get::<Option<i64>, _>(column)
        .map_err(|e| e.to_string())
}
