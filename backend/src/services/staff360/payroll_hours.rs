//! Çalışma saati ve saatlik hak ediş.
//!
//! Ücretli süre yalnız onaylanmış personel çalışma kayıtlarından gelir. Kasa vardiyası
//! veya planlanan bitiş, tek başına çalışılmış süre kanıtı değildir.
//!
//! Gece yarısını aşan kayıt dönem sınırında zamana göre bölünür; çıkışta personel hesabı
//! kesilmiş kayıt ise tamamen o hesapta kalır ve buradan çıkarılır (çifte ödeme olmasın).

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_period::{current_key, period_window};
use crate::services::staff360::payroll_types::HourlyEarnings;

pub const HOURS_SOURCE: &str = "onaylanmış çalışma kayıtları";

/// Dönemle kesişen onaylı kayıtları toplar. Dönem sınırında mola, tüm mola dakikası
/// yalnızca giriş zamanının bulunduğu döneme yazılır.
pub async fn worked_seconds(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    from: &str,
    to: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(MAX(0,
                   MIN(CAST(strftime('%s', ended_at) AS INTEGER), CAST(strftime('%s', ?4) AS INTEGER))
                 - MAX(CAST(strftime('%s', started_at) AS INTEGER), CAST(strftime('%s', ?3) AS INTEGER))
                 - CASE WHEN started_at >= ?3 THEN break_minutes * 60 ELSE 0 END)), 0)
           FROM staff_work_sessions
          WHERE tenant_id = ?1 AND user_id = ?2 AND status = 'CLOSED'
            AND ended_at IS NOT NULL
            -- Çıkışta hesabı kesilen kayıt personel hesabında ödenir; bordroda ikinci kez sayılmaz.
            AND NOT EXISTS (SELECT 1 FROM staff_settlements s
                             WHERE s.tenant_id = staff_work_sessions.tenant_id
                               AND s.work_session_id = staff_work_sessions.id)
            AND CAST(strftime('%s', started_at) AS INTEGER) < CAST(strftime('%s', ?4) AS INTEGER)
            AND CAST(strftime('%s', ended_at) AS INTEGER) > CAST(strftime('%s', ?3) AS INTEGER)",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("onaylı çalışma süresi okunamadı: {e}"))
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
    _can_see_amounts: bool,
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
    let (model, pay_period, _rate) =
        rule.ok_or_else(|| "NOT_FOUND: bu personelin maaş kuralı yok".to_string())?;
    if model != "HOURLY" {
        return Err("VALIDATION: personel saatlik ücretli değil".to_string());
    }
    let window = period_window(&pay_period, &current_key(&pay_period, today)?)?;
    let seconds = worked_seconds(pool, tenant_id, user_id, &window.from, &window.to).await?;
    Ok(HourlyEarnings {
        pay_period,
        period: window.key,
        from: window.from,
        to: window.to,
        worked_seconds: seconds,
        // Saatlik karşılığı kişi kartında gösterilmez; yalnız bordroda OWNER ve
        // MANAGER tutarı görür. Bu endpoint sadece fiili süreyi raporlar.
        hourly_rate_cents: None,
        earned_cents: None,
        source: HOURS_SOURCE.to_string(),
    })
}
