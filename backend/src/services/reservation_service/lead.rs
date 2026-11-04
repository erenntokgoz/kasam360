//! Rezervasyonlu masanın ne zaman kapanacağı.
//!
//! Neden ayrı kural: masa rezervasyon alındığı an kapanırsa akşama yazılan rezervasyon
//! bütün gün satışı durdurur. Masa, işletmenin seçtiği süre kalana kadar normal çalışır.

use chrono::{DateTime, Utc};
use sqlx::SqliteConnection;

pub const DEFAULT_LEAD_MINUTES: i64 = 60;

pub fn is_valid_lead(minutes: i64) -> bool {
    (30..=120).contains(&minutes) && minutes % 15 == 0
}

/// Okunamayan saat kapanmış sayılır: masa yanlışlıkla satışa açılmasın.
pub fn is_due(reserved_at: &str, now: DateTime<Utc>, lead_minutes: i64) -> bool {
    DateTime::parse_from_rfc3339(reserved_at).map_or(true, |at| {
        at.with_timezone(&Utc) - chrono::Duration::minutes(lead_minutes) <= now
    })
}

/// Salon planındaki durum: kayıtlı durum değişmeden süreye göre türetilir, böylece
/// ayar değişince eski rezervasyonlar da yeni kurala uyar.
pub fn displayed_status(
    stored: &str,
    reserved_at: Option<&str>,
    now: DateTime<Utc>,
    lead_minutes: i64,
) -> String {
    match reserved_at {
        Some(at) if stored == "AVAILABLE" && is_due(at, now, lead_minutes) => {
            "RESERVED".to_string()
        }
        Some(at) if stored == "RESERVED" && !is_due(at, now, lead_minutes) => {
            "AVAILABLE".to_string()
        }
        // Kaydı kapanmış rezervasyonun bayrağı kalmış olabilir: masa kilitli görünmez.
        None if stored == "RESERVED" => "AVAILABLE".to_string(),
        _ => stored.to_string(),
    }
}

pub async fn lead_minutes(conn: &mut SqliteConnection, tenant_id: &str) -> Result<i64, String> {
    let stored: Option<i64> =
        sqlx::query_scalar("SELECT lead_minutes FROM reservation_settings WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_optional(conn)
            .await
            .map_err(|e| e.to_string())?;
    Ok(stored.unwrap_or(DEFAULT_LEAD_MINUTES))
}

pub async fn set_lead_minutes(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    minutes: i64,
) -> Result<(), String> {
    if !is_valid_lead(minutes) {
        return Err(
            "VALIDATION: süre 30 ile 120 dakika arasında, 15 dakikalık olmalıdır".to_string(),
        );
    }
    sqlx::query(
        "INSERT INTO reservation_settings (tenant_id, lead_minutes) VALUES (?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET lead_minutes = excluded.lead_minutes",
    )
    .bind(tenant_id)
    .bind(minutes)
    .execute(conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
