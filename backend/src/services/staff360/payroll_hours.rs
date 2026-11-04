//! Çalışma saati ve saatlik hak ediş.
//!
//! Saat kaynağı yalnız kapanmış kasa vardiyalarıdır (`shifts.cashier_id`). Garsonun
//! `waiter_clock_in` olayı yalnız girişi yazar, çıkış kaydı yoktur; süre ondan
//! hesaplanırsa uydurma olurdu, bu yüzden sayılmaz.

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_period::{current_key, period_window};
use crate::services::staff360::payroll_types::HourlyEarnings;

pub const HOURS_SOURCE: &str = "kapanmış kasa vardiyaları";

/// Kapanmış vardiye saatleri. Kapanmamış vardiya sayılmaz: yarım kalmış vardiya
/// saatlik ücreti eksik hesaplanırdı.
pub async fn worked_seconds(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    from: &str,
    to: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(strftime('%s', closed_at) AS INTEGER)
                           - CAST(strftime('%s', opened_at) AS INTEGER)), 0)
           FROM shifts
          WHERE tenant_id = ?1 AND cashier_id = ?2 AND closed_at IS NOT NULL
            AND opened_at >= ?3 AND closed_at <= ?4",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("vardiye saati okunamadi: {e}"))
}

/// Saniye üzerinden tam sayı hesap: saat ücreti float'a düşmez.
pub fn hourly_pay_cents(seconds: i64, hourly_rate_cents: i64) -> Result<i64, String> {
    let pay = (i128::from(seconds) * i128::from(hourly_rate_cents) + 1800) / 3600;
    i64::try_from(pay).map_err(|_| "OVERFLOW: saat ücreti taştı".to_string())
}

/// Dayanak metnindeki saat: tek ondalık, yuvarlanmış.
pub fn hours_text(seconds: i64) -> String {
    let tenths = (seconds + 180) / 360;
    format!("{}.{}", tenths / 10, tenths % 10)
}

/// Saatlik çalışanın içinde bulunulan dönemdeki hak edişi. Dönem kişinin
/// kuralındaki hakediş dönemidir; bordro aynı pencereyi kullanır.
pub async fn current_earnings(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    today: NaiveDate,
    can_see_amounts: bool,
) -> Result<HourlyEarnings, String> {
    let rule: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT model, pay_period, hourly_rate_cents FROM payroll_rules
          WHERE tenant_id = ?1 AND user_id = ?2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (model, pay_period, rate) =
        rule.ok_or_else(|| "NOT_FOUND: bu personelin maaş kuralı yok".to_string())?;
    if model != "HOURLY" {
        return Err("VALIDATION: personel saatlik ücretli değil".to_string());
    }
    let window = period_window(&pay_period, &current_key(&pay_period, today)?)?;
    let seconds = worked_seconds(pool, tenant_id, user_id, &window.from, &window.to).await?;
    let earned = hourly_pay_cents(seconds, rate)?;
    Ok(HourlyEarnings {
        pay_period,
        period: window.key,
        from: window.from,
        to: window.to,
        worked_seconds: seconds,
        hourly_rate_cents: can_see_amounts.then_some(rate),
        earned_cents: can_see_amounts.then_some(earned),
        source: HOURS_SOURCE.to_string(),
    })
}
