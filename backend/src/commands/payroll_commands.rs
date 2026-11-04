//! Bordro kartı komutları: bahşiş çarpanı, saatlik hak ediş ve avans düzeltmesi.
//!
//! `staff_commands.rs` 500 satır sınırına yaklaştığı için ayrı dosyadadır; kapılar
//! aynıdır: rol, zorunlu kiracı ve tutar gizliliği.

use crate::services::audit_service::{self, AuditContext, AuditService};
use crate::services::expense_service;
use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_types::HourlyEarnings;
use crate::services::staff360::{payroll_hours, payroll_service};
use crate::DbPool;
use tauri::State;

fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())
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
    crate::rbac::require_payroll_amounts(&actor_role)?;
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
    crate::rbac::require_payroll_amounts(&actor_role)?;
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
