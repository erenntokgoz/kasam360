//! Personel giriş-çıkış kaydı ve çıkışta ücret hesabı.
//!
//! Kayıt kapanınca (çıkış) aynı işlemde ücret hesaplanır ve personel borcu olarak
//! yazılır; ödeme sorusu bundan sonra gelir. Böylece "ödendi mi?" sorusu yanıtsız
//! kalsa bile borç kaybolmaz. Zamanlar kanonik UTC saklanır; gece yarısını aşan
//! vardiya iki an arasındaki farkla hesaplanır (bkz. `shift_math`).

use crate::services::audit_service::{self, AuditContext, AuditService};
use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_types::StaffWorkSession;
use crate::services::staff360::shift_math;
use crate::services::staff360::staff_settlement::{self, ClosedSession, SessionSettlement};
use crate::DbPool;
use tauri::State;

/// Onaylanmış fiili çalışma kaydı; boş çıkış açık kalır ve hak edişe girmez.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkSessionInput {
    pub id: String,
    pub user_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub break_minutes: i64,
}

fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())
}

/// Girişi açar, kaydı düzeltir ya da çıkışı kapatır. Çıkışta hesaplanan ücret döner;
/// ücret üretilmediyse `note` nedeni söyler.
#[tauri::command]
pub async fn save_staff_work_session(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    input: WorkSessionInput,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<SessionSettlement, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    if input.id.trim().is_empty() {
        return Err("VALIDATION: çalışma kaydı geçersiz".to_string());
    }
    let started = shift_math::parse_instant(&input.started_at, "giriş zamanı")?;
    let ended = input
        .ended_at
        .as_deref()
        .map(|value| shift_math::parse_instant(value, "çıkış zamanı"))
        .transpose()?;
    let worked_seconds = match &ended {
        Some(end) => {
            shift_math::ensure_not_future(end, chrono::Utc::now())?;
            shift_math::net_worked_seconds(&started, end, input.break_minutes)?
        }
        None if input.break_minutes != 0 => {
            return Err("VALIDATION: açık kayıtta mola henüz girilmez".to_string());
        }
        None => 0,
    };
    // Kanonik UTC metin: karışık ofsetli kayıtlar metin olarak karşılaştırılamaz.
    let started_at = shift_math::canonical_utc(&started);
    let ended_at = ended.as_ref().map(shift_math::canonical_utc);
    let work_date = shift_math::work_date(&started);

    state.lan_sync.require_local_write()?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let active: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE tenant_id = ? AND id = ? AND is_active = 1")
            .bind(&tenant)
            .bind(&input.user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if active.is_none() {
        return Err("NOT_FOUND: etkin personel bulunamadı".into());
    }
    let status = if ended.is_some() { "CLOSED" } else { "OPEN" };
    let existing: Option<(String, Option<String>, i64, String)> = sqlx::query_as(
        "SELECT started_at, ended_at, break_minutes, user_id FROM staff_work_sessions
          WHERE tenant_id = ? AND id = ?",
    )
    .bind(&tenant)
    .bind(&input.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if let Some((stored_start, stored_end, stored_break, stored_user)) = &existing {
        // Hesap giriş zamanından türer; giriş sessizce başka bir değere çekilemez.
        let stored = shift_math::parse_instant(stored_start, "kayıtlı giriş zamanı")?;
        if stored.timestamp() != started.timestamp() || stored_user != &input.user_id {
            return Err(
                "CONFLICT: giriş zamanı ve personel kayıt açıldıktan sonra değişmez".into(),
            );
        }
        let same_end = match (stored_end, &ended_at) {
            (None, None) => true,
            (Some(old), Some(new)) => {
                shift_math::parse_instant(old, "kayıtlı çıkış zamanı")?.timestamp()
                    == shift_math::parse_instant(new, "çıkış zamanı")?.timestamp()
            }
            _ => false,
        };
        if stored_end.is_some() && ended.is_none() {
            return Err("CONFLICT: kapanmış çalışma kaydı yeniden açılamaz".into());
        }
        if same_end && *stored_break == input.break_minutes {
            // Aynı istek tekrarlandı: yeni yazma yok, mevcut hesap döner.
            return settlement_reply(&mut tx, &tenant, &input.id, &actor_role).await;
        }
    }
    let id_owner: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM staff_work_sessions WHERE id = ?")
            .bind(&input.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if id_owner.as_deref().is_some_and(|owner| owner != tenant) {
        return Err("CONFLICT: çalışma kaydı kimliği zaten kullanılıyor".into());
    }
    let collision: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM staff_work_sessions WHERE tenant_id = ? AND user_id = ? AND id != ?
           AND ((status = 'OPEN') OR (ended_at > ? AND (? IS NULL OR started_at < ?))) LIMIT 1",
    )
    .bind(&tenant)
    .bind(&input.user_id)
    .bind(&input.id)
    .bind(&started_at)
    .bind(&ended_at)
    .bind(&ended_at)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if collision.is_some() {
        return Err("CONFLICT: personelin başka bir açık veya çakışan çalışma kaydı var".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let write = sqlx::query(
        "INSERT INTO staff_work_sessions (id, tenant_id, user_id, started_at, ended_at, break_minutes, status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET ended_at = excluded.ended_at,
           break_minutes = excluded.break_minutes, status = excluded.status,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at
         WHERE staff_work_sessions.tenant_id = excluded.tenant_id",
    ).bind(&input.id).bind(&tenant).bind(&input.user_id).bind(&started_at).bind(&ended_at)
      .bind(input.break_minutes).bind(status).bind(&actor_id).bind(&actor_id).bind(&now).bind(&now)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if write.rows_affected() != 1 {
        return Err("CONFLICT: çalışma kaydı yazılamadı".into());
    }
    let context = AuditContext::new(
        tenant.clone(),
        actor_id.clone(),
        actor_role.clone(),
        audit_service::category::PERSONEL,
        "staff:work_session",
        input.id.clone(),
        serde_json::json!({"userId": input.user_id, "startedAt": started_at,
            "endedAt": ended_at, "breakMinutes": input.break_minutes, "status": status}),
        now.clone(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &context).await?;

    let mut reply = SessionSettlement {
        settlement: None,
        note: None,
    };
    if ended.is_some() {
        let accrual = staff_settlement::accrue_on_close(
            &mut tx,
            &tenant,
            &ClosedSession {
                id: &input.id,
                user_id: &input.user_id,
                work_date: &work_date,
                worked_seconds,
            },
            &actor_id,
            &now,
        )
        .await?;
        if let Some(settlement_id) = &accrual.settlement_id {
            let context = AuditContext::new(
                tenant.clone(),
                actor_id.clone(),
                actor_role.clone(),
                audit_service::category::PERSONEL,
                "staff:settlement_accrued",
                settlement_id.clone(),
                serde_json::json!({"userId": input.user_id, "workSessionId": input.id,
                    "workDate": work_date, "workedSeconds": worked_seconds}),
                now.clone(),
            )?;
            AuditService::append(&mut tx, &audit_lock, &context).await?;
        }
        reply = settlement_reply_from(&mut tx, &tenant, accrual, &actor_role).await?;
    }
    tx.commit().await?;
    Ok(reply)
}

fn amounts_visible(actor_role: &str) -> bool {
    crate::rbac::require_payroll_amounts(actor_role).is_ok()
}

async fn settlement_reply_from(
    conn: &mut sqlx::SqliteConnection,
    tenant: &str,
    accrual: staff_settlement::Accrual,
    actor_role: &str,
) -> Result<SessionSettlement, String> {
    let settlement = match &accrual.settlement_id {
        Some(id) => {
            Some(staff_settlement::get(conn, tenant, id, amounts_visible(actor_role)).await?)
        }
        None => None,
    };
    Ok(SessionSettlement {
        settlement,
        note: accrual.note,
    })
}

/// Tekrarlanan kapatma isteğinde mevcut hesabı döndürür.
async fn settlement_reply(
    conn: &mut sqlx::SqliteConnection,
    tenant: &str,
    session_id: &str,
    actor_role: &str,
) -> Result<SessionSettlement, String> {
    let id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM staff_settlements WHERE tenant_id = ? AND work_session_id = ?",
    )
    .bind(tenant)
    .bind(session_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    settlement_reply_from(
        conn,
        tenant,
        staff_settlement::Accrual {
            settlement_id: id,
            note: None,
        },
        actor_role,
    )
    .await
}

#[tauri::command]
pub async fn list_staff_work_sessions(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<StaffWorkSession>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, i64, String)>(
        "SELECT id, user_id, started_at, ended_at, break_minutes, status
           FROM staff_work_sessions WHERE tenant_id = ? AND user_id = ?
          ORDER BY started_at DESC LIMIT 60",
    )
    .bind(&tenant)
    .bind(&user_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(id, user_id, started_at, ended_at, break_minutes, status)| StaffWorkSession {
                id,
                user_id,
                started_at,
                ended_at,
                break_minutes,
                status,
            },
        )
        .collect())
}
