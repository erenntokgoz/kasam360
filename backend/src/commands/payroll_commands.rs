//! Bordro kartı komutları: bahşiş çarpanı, saatlik hak ediş ve avans düzeltmesi.
//!
//! `staff_commands.rs` 500 satır sınırına yaklaştığı için ayrı dosyadadır; kapılar
//! aynıdır: rol, zorunlu kiracı ve tutar gizliliği.

use crate::services::audit_service::{self, AuditContext, AuditService};
use crate::services::expense_service;
use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_types::{HourlyEarnings, StaffWorkSession};
use crate::services::staff360::{payroll_hours, payroll_service};
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

#[tauri::command]
pub async fn save_staff_work_session(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    input: WorkSessionInput,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    if input.id.trim().is_empty() || input.break_minutes < 0 {
        return Err("VALIDATION: çalışma kaydı ve mola geçersiz".to_string());
    }
    let started = chrono::DateTime::parse_from_rfc3339(&input.started_at)
        .map_err(|_| "VALIDATION: giriş zamanı RFC3339 olmalı".to_string())?;
    let ended = input
        .ended_at
        .as_deref()
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .map_err(|_| "VALIDATION: çıkış zamanı RFC3339 olmalı".to_string())
        })
        .transpose()?;
    if let Some(end) = ended {
        let seconds = (end - started).num_seconds();
        if seconds <= 0 || input.break_minutes > seconds / 60 {
            return Err(
                "VALIDATION: çıkış girişten sonra olmalı, mola çalışma süresini aşamaz".to_string(),
            );
        }
    } else if input.break_minutes != 0 {
        return Err("VALIDATION: açık kayıtta mola henüz girilmez".to_string());
    }
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
    let existing: Option<(String, Option<String>, i64)> = sqlx::query_as(
        "SELECT started_at, ended_at, break_minutes FROM staff_work_sessions WHERE tenant_id = ? AND id = ?",
    ).bind(&tenant).bind(&input.id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if existing.as_ref().is_some_and(|row| {
        row.0 == input.started_at && row.1 == input.ended_at && row.2 == input.break_minutes
    }) {
        return Ok(());
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
    .bind(&input.started_at)
    .bind(&input.ended_at)
    .bind(&input.ended_at)
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
    ).bind(&input.id).bind(&tenant).bind(&input.user_id).bind(&input.started_at).bind(&input.ended_at)
      .bind(input.break_minutes).bind(status).bind(&actor_id).bind(&actor_id).bind(&now).bind(&now)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if write.rows_affected() != 1 {
        return Err("CONFLICT: çalışma kaydı yazılamadı".into());
    }
    let context = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        audit_service::category::PERSONEL,
        "staff:work_session",
        input.id,
        serde_json::json!({"userId": input.user_id, "startedAt": input.started_at,
            "endedAt": input.ended_at, "breakMinutes": input.break_minutes, "status": status}),
        now,
    )?;
    AuditService::append(&mut tx, &audit_lock, &context).await?;
    tx.commit().await?;
    Ok(())
}

fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())
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

#[tauri::command]
pub async fn pay_payroll_run(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    payroll_run_id: String,
    amount_cents: i64,
    payment_method: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<i64, String> {
    crate::rbac::require_owner(&actor_role)?;
    state.lan_sync.require_local_write()?;
    if amount_cents <= 0 || !matches!(payment_method.as_str(), "CASH" | "BANK_TRANSFER") {
        return Err("VALIDATION: ödeme tutarı veya kanalı geçersiz".into());
    }
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let conn = &mut *tx;
    let payroll_run_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM payroll_runs WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(&tenant)
    .bind(&payroll_run_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bordro kaydı bulunamadı".to_string())?;
    let payment_lock = sqlx::query_scalar::<_, i64>(
        "SELECT net_cents FROM payroll_runs WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(&tenant)
    .bind(&payroll_run_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    // Aynı anlık görüntü hesabı ile ödeme kaydı arasındaki sınırda tekrar
    // bordro hesaplanırsa kilitli transaction yeniden doğrular.
    let row: Option<(i64, i64, String)> = sqlx::query_as(
        "SELECT net_cents,
                COALESCE((SELECT SUM(amount_cents) FROM payroll_payments p WHERE p.tenant_id = r.tenant_id AND p.payroll_run_id = r.id),0),
                period
           FROM payroll_runs r WHERE tenant_id = ? AND id = ?",
    ).bind(&tenant).bind(&payroll_run_id).fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;
    let Some((net, paid, period)) = row else {
        return Err("NOT_FOUND: bordro kaydı bulunamadı".into());
    };
    let remaining = net.saturating_sub(paid).max(0);
    if amount_cents > remaining {
        return Err(format!("CONFLICT: kalan bordro borcu {remaining} kuruş"));
    }
    if payment_lock != net {
        return Err("CONFLICT: bordro tutarı değişti; yeniden hesaplayın".into());
    }
    if payment_method == "CASH" {
        let shift: Option<(String, String, i64)> = sqlx::query_as(
            "SELECT id, opened_at, expected_amount_cents FROM shifts WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
        ).bind(&tenant).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
        let Some((shift_id, opened_at, opening)) = shift else {
            return Err("SHIFT_REQUIRED: bordro nakit ödemesi için açık vardiya gerekir".into());
        };
        let conn = &mut *tx;
        crate::commands::cashier_commands::calculate_expected_shift_balance(
            conn, &tenant, &shift_id, &opened_at, None, opening,
        )
        .await?;
        sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?)")
            .bind(crate::id_generator::generate_id("csh")).bind(&tenant).bind(&shift_id).bind(amount_cents)
            .bind(format!("Bordro ödemesi · {period}")).bind(&actor_id).bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    sqlx::query("INSERT INTO payroll_payments (id, tenant_id, payroll_run_id, amount_cents, payment_method, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crate::id_generator::generate_id("ppay")).bind(&tenant).bind(&payroll_run_id)
        .bind(amount_cents).bind(&payment_method).bind(&actor_id).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let context = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        audit_service::category::PERSONEL,
        "payroll:payment",
        payroll_run_id.clone(),
        serde_json::json!({"period": period, "amountCents": amount_cents, "paymentMethod": payment_method}),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &context).await?;
    tx.commit().await?;
    Ok(remaining - amount_cents)
}

/// Bahşiş çarpanı dağıtım payını belirler; para kararı olduğu için yalnız sahip yazar.
#[tauri::command]
pub async fn set_tip_multiplier(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: String,
    tip_multiplier_percent: i64,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_owner(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    payroll_service::set_tip_multiplier(&pool, &tenant, &user_id, tip_multiplier_percent).await
}

/// İçinde bulunulan dönemin saatleri müdüre de görünür; tutar yalnız sahibe.
#[tauri::command]
pub async fn get_hourly_earnings(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: String,
    pool: State<'_, DbPool>,
) -> Result<HourlyEarnings, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let can_see = crate::rbac::require_payroll_amounts(&actor_role).is_ok();
    let today = chrono::Local::now().date_naive();
    payroll_hours::current_earnings(&pool, &tenant, &user_id, today, can_see).await
}

/// Avansı tek işlemde düzeltir: iptal ve yeni kayıt birlikte yazılır ya da hiçbiri.
#[tauri::command]
pub async fn correct_staff_advance(
    expense_id: String,
    period: String,
    amount_cents: i64,
    payment_method: String,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    crate::rbac::require_owner(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let id = expense_service::correct_staff_advance(
        &mut tx,
        &tenant,
        &expense_id,
        &period,
        amount_cents,
        &payment_method,
        &actor_id,
        &chrono::Utc::now().to_rfc3339(),
    )
    .await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        audit_service::category::PERSONEL,
        "staff:advance_corrected",
        id.clone(),
        serde_json::json!({
            "voidedExpenseId": expense_id,
            "period": period,
            "amountCents": amount_cents,
            "paymentMethod": payment_method,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(id)
}
