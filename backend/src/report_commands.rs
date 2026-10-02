//! Birleşik rapor merkezinin Tauri komut katmanı.
//!
//! Neden yeni komutlar: `get_daily_summary`, `get_receipts` ve
//! `get_shift_history` rapor verisini üç ayrı komuttan dağıtıyordu ve üçü de
//! ya `tenant_id` almıyordu ya da parametreyi yok sayıyordu. Bu modül tüm
//! rapor okumasını tek sözleşmeye toplar:
//!
//! - `tenant_id` zorunlu ve boşsa fail-closed reddedilir,
//! - tarih aralığı zorunludur ("tüm zamanlar" filtresiz tarama yapmaz),
//! - satır sayısı arayüzün istediği değere kırpılır (sabit üst sınır),
//! - tutarlar kuruş (`*_cents`) olarak döner.
//!
//! MASTER bu komutlara giremez: platform ekranı kendi komutlarını kullanır.

use crate::db::DbPool;
use crate::rbac;
use crate::services::report_service::{
    self, AdjustmentsReportDto, ReceiptReportRowDto, ReportRange, SalesReportDto,
    ShiftReportRowDto,
};

/// Arayüzün istediği satır sayısı bu aralıkta tutulur. Sınırsız liste hem
/// taşıma katmanını hem de Excel dışa aktarımını gereksiz büyütür.
const MIN_LIMIT: i64 = 1;
const MAX_LIMIT: i64 = 500;
const DEFAULT_LIMIT: i64 = 200;

/// Çağıranın tenant'ı zorunludur: eksik veya boşsa fail-closed reddedilir.
fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

/// Tarih aralığı doğrulanır: boş, çözülemeyen veya ters aralık reddedilir.
///
/// Neden ayrı doğrulama: ters aralık sessizce "0 satır" dönerdi ve yönetici
/// bunu "satış yok" sanardı.
fn require_range(from: Option<&str>, to: Option<&str>) -> Result<ReportRange, String> {
    let from_raw = from
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "INVALID_ARGUMENT: from is required".to_string())?;
    let to_raw = to
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "INVALID_ARGUMENT: to is required".to_string())?;

    let from_dt = chrono::DateTime::parse_from_rfc3339(from_raw)
        .map_err(|_| "INVALID_ARGUMENT: from must be ISO-8601".to_string())?;
    let to_dt = chrono::DateTime::parse_from_rfc3339(to_raw)
        .map_err(|_| "INVALID_ARGUMENT: to must be ISO-8601".to_string())?;
    if to_dt < from_dt {
        return Err("INVALID_ARGUMENT: to must not be before from".to_string());
    }

    Ok(ReportRange::new(from_raw, to_raw))
}

fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        None => DEFAULT_LIMIT,
        Some(value) => value.clamp(MIN_LIMIT, MAX_LIMIT),
    }
}

#[tauri::command]
pub async fn get_sales_report(
    actor_role: String,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<SalesReportDto, String> {
    rbac::require_reporting(&actor_role)?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let range = require_range(from.as_deref(), to.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    report_service::sales_report(&mut conn, &tid, &range).await
}

#[tauri::command]
pub async fn get_shift_report(
    actor_role: String,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ShiftReportRowDto>, String> {
    rbac::require_reporting(&actor_role)?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let range = require_range(from.as_deref(), to.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    report_service::shift_report(&mut conn, &tid, &range, clamp_limit(limit)).await
}

#[tauri::command]
pub async fn get_receipts_report(
    actor_role: String,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ReceiptReportRowDto>, String> {
    rbac::require_reporting(&actor_role)?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let range = require_range(from.as_deref(), to.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    report_service::receipts_report(&mut conn, &tid, &range, clamp_limit(limit)).await
}

#[tauri::command]
pub async fn get_adjustments_report(
    actor_role: String,
    tenant_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<AdjustmentsReportDto, String> {
    rbac::require_reporting(&actor_role)?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let range = require_range(from.as_deref(), to.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    report_service::adjustments_report(&mut conn, &tid, &range).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(from: &str, to: &str) -> (Option<String>, Option<String>) {
        (Some(from.to_string()), Some(to.to_string()))
    }

    #[test]
    fn tenant_bos_is_fail_closed() {
        assert!(require_tenant(None).is_err());
        assert!(require_tenant(Some("   ")).is_err());
        assert_eq!(require_tenant(Some(" tnt_1 ")).unwrap(), "tnt_1");
    }

    #[test]
    fn aralik_zorunlu_ve_iso_olmalidir() {
        assert!(require_range(None, Some("2026-01-02T00:00:00+00:00")).is_err());
        assert!(require_range(Some("2026-01-01T00:00:00+00:00"), None).is_err());
        assert!(require_range(Some("dün"), Some("bugün")).is_err());
    }

    #[test]
    fn ters_aralik_reddedilir() {
        let (from, to) = base("2026-02-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00");
        assert!(require_range(from.as_deref(), to.as_deref()).is_err());
    }

    #[test]
    fn dogru_aralik_kabul_edilir() {
        let (from, to) = base("2026-01-01T00:00:00+00:00", "2026-01-31T23:59:59+00:00");
        let range = require_range(from.as_deref(), to.as_deref()).unwrap();
        assert_eq!(range.days(), 31);
    }

    #[test]
    fn limit_kirpilir() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), MIN_LIMIT);
        assert_eq!(clamp_limit(Some(10)), 10);
        assert_eq!(clamp_limit(Some(100_000)), MAX_LIMIT);
    }

    #[test]
    fn kasiver_rapor_goremez() {
        assert!(rbac::require_reporting("CASHIER").is_err());
        assert!(rbac::require_reporting("MASTER").is_err());
        assert!(rbac::require_reporting("OWNER").is_ok());
        assert!(rbac::require_reporting("MANAGER").is_ok());
    }
}
