//! Faz 11 B5 — Personel 360° Tauri komutları.
//!
//! Her komut üç kapıdan geçer: rol (RBAC), tenant (zorunlu), bağlam (fail-closed).
//! `tenant_id` `Option` olarak gelir; `require_tenant_scope` çağıranı reddeder.
//! Bu desen `shift_commands.rs` ile aynıdır: kapıyı atlamak kolay olmasın diye
//! tek yardımcıda toplandı.

use serde::Serialize;
use tauri::State;

use crate::services::staff360::payroll_types::{
    PayrollRule, PayrollRuleInput, PayrollRun, StaffKpi, SuspiciousFlag, TipAllocation,
    TipAllocationInput, TipPoolSummary,
};
use crate::services::staff360::staff_types::{
    CustodyRecord, Incident, IncidentInput, LeaveInput, LeaveRequest, ShiftPlan, ShiftPlanInput,
    StaffProfile, StaffProfileInput,
};
use crate::services::staff360::{kpi_service, payroll_service, staff_service, suspicious_service, tip_service};
use crate::DbPool;

/// Tenant zorunluluğu. Eksik gelirse hata verir; `DEFAULT_TENANT`'a düşmez —
/// düşseydi yanlış işletmenin verisi okunurdu.
fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    let t = tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())?;
    Ok(t.to_string())
}

/// Maaş tutarı görüntüleme hakkı. `require_payroll_amounts` yalnız OWNER'a
/// izin verir; müdür `false` döner ve servis `amounts: None` üretir.
fn can_see_amounts(actor_role: &str) -> bool {
    crate::rbac::require_payroll_amounts(actor_role).is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BirthdayRow {
    pub user_id: String,
    pub full_name: String,
    pub date: String,
}

#[tauri::command]
pub async fn list_staff_profiles(
    tenant_id: Option<String>,
    actor_role: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<StaffProfile>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::list_profiles(&pool, &tenant).await
}

#[tauri::command]
pub async fn save_staff_profile(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    input: StaffProfileInput,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::upsert_profile(&pool, &tenant, &actor_id, &input).await
}

/// Doğum günü yaklaşan personel. `days_ahead` 0-365 ile sınırlandırılır.
#[tauri::command]
pub async fn get_upcoming_birthdays(
    tenant_id: Option<String>,
    actor_role: String,
    days_ahead: i64,
    pool: State<'_, DbPool>,
) -> Result<Vec<BirthdayRow>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let ham = staff_service::upcoming_birthdays(&pool, &tenant, days_ahead).await?;
    Ok(ham
        .into_iter()
        .map(|(user_id, full_name, date)| BirthdayRow {
            user_id,
            full_name,
            date,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Vardiya planı
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_shift_plans(
    tenant_id: Option<String>,
    actor_role: String,
    from: String,
    to: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<ShiftPlan>, String> {
    crate::rbac::require_shift_planning(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::list_shift_plans(&pool, &tenant, &from, &to).await
}

#[tauri::command]
pub async fn add_shift_plan(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    plan: ShiftPlanInput,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    crate::rbac::require_shift_planning(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::add_shift_plan(&pool, &tenant, &actor_id, &plan).await
}

// ---------------------------------------------------------------------------
// İzin
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_leave_requests(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<LeaveRequest>, String> {
    crate::rbac::require_leave_request(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::list_leaves(&pool, &tenant, user_id.as_deref()).await
}

#[tauri::command]
pub async fn request_leave(
    tenant_id: Option<String>,
    actor_role: String,
    input: LeaveInput,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    crate::rbac::require_leave_request(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::request_leave(&pool, &tenant, &input).await
}

#[tauri::command]
pub async fn decide_leave(
    tenant_id: Option<String>,
    approver_id: String,
    actor_role: String,
    leave_id: String,
    approve: bool,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::decide_leave(&pool, &tenant, &approver_id, &leave_id, approve).await
}

// ---------------------------------------------------------------------------
// Zimmet
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_custody_records(
    tenant_id: Option<String>,
    actor_role: String,
    only_open: bool,
    pool: State<'_, DbPool>,
) -> Result<Vec<CustodyRecord>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::list_custody(&pool, &tenant, only_open).await
}

#[tauri::command]
pub async fn add_custody_record(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: String,
    item_name: String,
    quantity: i64,
    notes: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::add_custody(&pool, &tenant, &user_id, &item_name, quantity, notes.as_deref())
        .await
}

#[tauri::command]
pub async fn close_custody_record(
    tenant_id: Option<String>,
    actor_role: String,
    custody_id: String,
    damaged: bool,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::return_custody(&pool, &tenant, &custody_id, damaged).await
}

// ---------------------------------------------------------------------------
// Tutanak sicili
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_staff_incidents(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<Incident>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::list_incidents(&pool, &tenant, user_id.as_deref()).await
}

#[tauri::command]
pub async fn record_staff_incident(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    input: IncidentInput,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::record_incident(&pool, &tenant, &actor_id, &input).await
}

// ---------------------------------------------------------------------------
// Maaş
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_payroll_rules(
    tenant_id: Option<String>,
    actor_role: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<PayrollRule>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    payroll_service::list_rules(&pool, &tenant, can_see_amounts(&actor_role)).await
}

#[tauri::command]
pub async fn set_payroll_rule(
    tenant_id: Option<String>,
    actor_role: String,
    input: PayrollRuleInput,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_payroll_amounts(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    payroll_service::set_rule(&pool, &tenant, &input).await
}

#[tauri::command]
pub async fn run_payroll(
    tenant_id: Option<String>,
    actor_role: String,
    period: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<PayrollRun>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    payroll_service::run_payroll(&pool, &tenant, &period, can_see_amounts(&actor_role)).await
}

// ---------------------------------------------------------------------------
// Bahşiş havuzu
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_tip_pool_summary(
    tenant_id: Option<String>,
    actor_role: String,
    period: String,
    pool: State<'_, DbPool>,
) -> Result<TipPoolSummary, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    tip_service::pool_summary(&pool, &tenant, &period).await
}

#[tauri::command]
pub async fn distribute_tip_pool(
    tenant_id: Option<String>,
    actor_role: String,
    period: String,
    allocations: Vec<TipAllocationInput>,
    pool: State<'_, DbPool>,
) -> Result<Vec<TipAllocation>, String> {
    // Dağıtım para hareketidir: müdür göremez, yalnız sahibi dağıtabilir.
    crate::rbac::require_payroll_amounts(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    tip_service::distribute_pool(&pool, &tenant, &period, &allocations).await
}

// ---------------------------------------------------------------------------
// KPI ve radar
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_staff_kpi(
    tenant_id: Option<String>,
    actor_role: String,
    from: String,
    to: String,
    user_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<StaffKpi>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    kpi_service::kpi(&pool, &tenant, &from, &to, user_id.as_deref()).await
}

#[tauri::command]
pub async fn get_suspicious_activity(
    tenant_id: Option<String>,
    actor_role: String,
    from: String,
    to: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<SuspiciousFlag>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    suspicious_service::radar(&pool, &tenant, &from, &to).await
}
