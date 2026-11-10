//! Ücret kuralı yazma ve silme komutları.
//!
//! Ücret kuralı para kararıdır: sahip doğrudan değiştirir, müdür yalnız sahip onay
//! jetonuyla değiştirir. Her değişiklik denetim defterine yazılır.

use crate::approval_service::operation;
use crate::services::audit_service::{self, AuditContext, AuditService};
use crate::services::lan_sync::WritePool;
use crate::services::staff360::payroll_types::PayrollRuleInput;
use crate::services::staff360::{payroll_gate, payroll_rules};
use crate::DbPool;
use tauri::State;

fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())
}

/// Ücret kuralını yazar. Sahip doğrudan değiştirir; müdür sahip onay jetonu olmadan değiştiremez.
#[tauri::command]
pub async fn set_payroll_rule(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    input: PayrollRuleInput,
    approval_token: Option<String>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    state.lan_sync.require_local_write()?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    // Onay kapsamı yeni ücrettir: onaylayan hangi tutarı onayladığını bilir.
    let wage = if input.model == "HOURLY" {
        input.hourly_rate_cents
    } else {
        input.base_salary_cents
    };
    let authorized = payroll_gate::authorize_money_out(
        &mut tx,
        &audit_lock,
        &tenant,
        &actor_id,
        &actor_role,
        operation::PAYROLL_RULE,
        &payroll_gate::resource(operation::PAYROLL_RULE, &input.user_id),
        wage,
        approval_token.as_deref(),
    )
    .await?;
    payroll_rules::set_rule_in(&mut tx, &tenant, &input).await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        audit_service::category::PERSONEL,
        "payroll:rule_set",
        input.user_id.clone(),
        serde_json::json!({
            "model": input.model,
            "baseSalaryCents": input.base_salary_cents,
            "hourlyRateCents": input.hourly_rate_cents,
            "payPeriod": input.pay_period,
            "approverId": authorized.approver_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_payroll_rule(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    user_id: String,
    approval_token: Option<String>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    state.lan_sync.require_local_write()?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let authorized = payroll_gate::authorize_money_out(
        &mut tx,
        &audit_lock,
        &tenant,
        &actor_id,
        &actor_role,
        operation::PAYROLL_RULE,
        &payroll_gate::resource(operation::PAYROLL_RULE, &user_id),
        0,
        approval_token.as_deref(),
    )
    .await?;
    payroll_rules::delete_rule_in(&mut tx, &tenant, &user_id).await?;
    let ctx = AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        audit_service::category::PERSONEL,
        "payroll:rule_deleted",
        user_id,
        serde_json::json!({ "approverId": authorized.approver_id }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await?;
    Ok(())
}
