//! Çıkışta personel hesabı kesme: kuraldan ücreti türetir ve hesap satırını yazar.
//!
//! Saatlik ücret net süreden, günlük ücret kural tutarından gelir. Aynı kayıt tekrar
//! kapatılırsa ikinci hesap açılmaz; ödenmemiş hesap yeniden hesaplanır, ödeme almış
//! hesabın değişmesi reddedilir.

use sqlx::SqliteConnection;

use crate::id_generator::generate_id;
use crate::services::staff360::payroll_hours::hourly_pay_cents;
use crate::services::staff360::payroll_period::DAILY;
use crate::services::staff360::staff_settlement::{
    paid_total, text_error, Accrual, ClosedSession, KIND_DAILY, KIND_HOURLY,
};

/// Kuralın çıkış ücreti.
enum Plan {
    Wage {
        kind: &'static str,
        rate_cents: i64,
        earned_cents: i64,
    },
    /// Ücret üretilmedi; neden kullanıcıya söylenir, sessizce sıfır yazılmaz.
    Skip(String),
}

/// Saatlik ücret saniyeden, günlük ücret kural tutarından gelir. Dönemlik (haftalık ve
/// aylık) kural çıkışta ücret üretmez; dönem bordrosunda hesaplanır.
fn plan(
    model: &str,
    pay_period: &str,
    base_cents: i64,
    hourly_cents: i64,
    worked_seconds: i64,
) -> Result<Plan, String> {
    if model == "HOURLY" {
        if hourly_cents <= 0 {
            return Ok(Plan::Skip(
                "Saatlik ücret tanımlı değil; ücret hesaplanmadı.".to_string(),
            ));
        }
        let earned = hourly_pay_cents(worked_seconds, hourly_cents)?;
        if earned <= 0 {
            return Ok(Plan::Skip("Çalışılan süre ücret doğurmadı.".to_string()));
        }
        return Ok(Plan::Wage {
            kind: KIND_HOURLY,
            rate_cents: hourly_cents,
            earned_cents: earned,
        });
    }
    if pay_period == DAILY && matches!(model, "FIXED" | "TIP") {
        if base_cents <= 0 {
            return Ok(Plan::Skip(
                "Günlük ücret tanımlı değil; ücret hesaplanmadı.".to_string(),
            ));
        }
        return Ok(Plan::Wage {
            kind: KIND_DAILY,
            rate_cents: base_cents,
            earned_cents: base_cents,
        });
    }
    Ok(Plan::Skip(
        "Bu personelin ücreti dönem bordrosunda hesaplanır.".to_string(),
    ))
}

/// Çalışma kaydı kapandığında ücreti hesaplar. Aynı kayıt tekrar kapatılırsa ikinci hesap
/// açılmaz; ödenmemiş hesap yeniden hesaplanır, ödeme almış hesabın değişmesi reddedilir.
pub async fn accrue_on_close(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    session: &ClosedSession<'_>,
    actor_id: &str,
    now_iso: &str,
) -> Result<Accrual, String> {
    let rule: Option<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT model, pay_period, base_salary_cents, hourly_rate_cents
           FROM payroll_rules WHERE tenant_id = ? AND user_id = ? AND active = 1",
    )
    .bind(tenant_id)
    .bind(session.user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let existing: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT id, worked_seconds, earned_cents FROM staff_settlements
          WHERE tenant_id = ? AND work_session_id = ?",
    )
    .bind(tenant_id)
    .bind(session.id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some((model, pay_period, base, hourly)) = rule else {
        return Ok(Accrual {
            settlement_id: existing.map(|row| row.0),
            note: Some("Maaş kuralı tanımlı değil; ücret hesaplanmadı.".to_string()),
        });
    };
    let (kind, rate, earned) =
        match plan(&model, &pay_period, base, hourly, session.worked_seconds)? {
            Plan::Wage {
                kind,
                rate_cents,
                earned_cents,
            } => (kind, rate_cents, earned_cents),
            Plan::Skip(note) => {
                return Ok(Accrual {
                    settlement_id: existing.map(|row| row.0),
                    note: Some(note),
                })
            }
        };

    if let Some((id, old_seconds, old_earned)) = existing {
        let unchanged = if kind == KIND_DAILY {
            old_earned == earned
        } else {
            old_seconds == session.worked_seconds && old_earned == earned
        };
        if unchanged {
            return Ok(Accrual {
                settlement_id: Some(id),
                note: None,
            });
        }
        if paid_total(conn, tenant_id, &id).await? > 0 {
            return Err(
                "CONFLICT: bu çıkış için ödeme yapılmış; çalışma kaydı artık değiştirilemez"
                    .to_string(),
            );
        }
        sqlx::query(
            "UPDATE staff_settlements SET worked_seconds = ?3, rate_cents = ?4, earned_cents = ?5
              WHERE tenant_id = ?1 AND id = ?2",
        )
        .bind(tenant_id)
        .bind(&id)
        .bind(session.worked_seconds)
        .bind(rate)
        .bind(earned)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
        return Ok(Accrual {
            settlement_id: Some(id),
            note: None,
        });
    }

    if kind == KIND_DAILY
        && daily_settled(conn, tenant_id, session.user_id, session.work_date).await?
    {
        return Ok(Accrual {
            settlement_id: None,
            note: Some("Bu gün için günlük ücret zaten hesaplandı.".to_string()),
        });
    }
    let id = generate_id("stl");
    sqlx::query(
        "INSERT INTO staff_settlements
             (id, tenant_id, user_id, work_session_id, work_date, kind, worked_seconds,
              rate_cents, earned_cents, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(session.user_id)
    .bind(session.id)
    .bind(session.work_date)
    .bind(kind)
    .bind(session.worked_seconds)
    .bind(rate)
    .bind(earned)
    .bind(actor_id)
    .bind(now_iso)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(Accrual {
        settlement_id: Some(id),
        note: None,
    })
}

/// Günlük ücretli personelin o günü çıkışta hesaplandı mı? Bordro aynı günü ikinci kez
/// saymasın diye `run_payroll` da bunu okur.
pub async fn daily_settled(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    work_date: &str,
) -> Result<bool, String> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM staff_settlements
          WHERE tenant_id = ? AND user_id = ? AND work_date = ? AND kind = 'DAILY' LIMIT 1",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(work_date)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(found.is_some())
}
