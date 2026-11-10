//! Personel 360° Tauri komutları.
//!
//! Her komut üç kapıdan geçer: rol (RBAC), tenant (zorunlu), bağlam (fail-closed).
//! `tenant_id` `Option` olarak gelir; `require_tenant_scope` çağıranı reddeder.
//! Bu desen `shift_commands.rs` ile aynıdır: kapıyı atlamak kolay olmasın diye
//! tek yardımcıda toplandı.

use crate::services::lan_sync::WritePool;
use serde::Serialize;
use tauri::State;

use crate::services::staff360::payroll_types::{
    PayrollRule, PayrollRun, StaffKpi, SuspiciousFlag, TipAllocation, TipAllocationInput,
    TipPoolSummary,
};
use crate::services::staff360::staff_types::{
    CustodyRecord, Incident, IncidentInput, ShiftPlan, ShiftPlanInput, StaffProfile,
    StaffProfileInput,
};
use crate::services::staff360::{
    kpi_service, payroll_service, staff_service, suspicious_service, tip_service,
};
use crate::DbPool;

/// Tenant zorunluluğu. Eksik gelirse hata verir; varsayılan kiracıya düşmez —
/// düşseydi yanlış işletmenin verisi okunurdu.
fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    let t = tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())?;
    Ok(t.to_string())
}

/// Maaş tutarı görüntüleme hakkı. OWNER ve MANAGER tenant bordrosunu görebilir.
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
    staff_service::list_profiles(&pool, &tenant, can_see_amounts(&actor_role)).await
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
    staff_service::upsert_profile(
        &pool,
        &tenant,
        &actor_id,
        can_see_amounts(&actor_role),
        &input,
    )
    .await
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

/// Gerçekleşmemiş planın gün ve saatini değiştirir.
#[tauri::command]
pub async fn update_shift_plan(
    tenant_id: Option<String>,
    actor_role: String,
    plan_id: String,
    plan: ShiftPlanInput,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_shift_planning(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::update_shift_plan(&pool, &tenant, &plan_id, &plan).await
}

/// Gerçekleşmemiş planı siler; gerçekleşen vardiya kasa kaydına bağlıdır.
#[tauri::command]
pub async fn delete_shift_plan(
    tenant_id: Option<String>,
    actor_role: String,
    plan_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_shift_planning(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::delete_shift_plan(&pool, &tenant, &plan_id).await
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
    staff_service::add_custody(
        &pool,
        &tenant,
        &user_id,
        &item_name,
        quantity,
        notes.as_deref(),
    )
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
    payroll_service::list_rules(&pool, &tenant, true).await
}

#[tauri::command]
pub async fn run_payroll(
    tenant_id: Option<String>,
    actor_role: String,
    pay_period: String,
    period: String,
    pool: State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<PayrollRun>, String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    payroll_service::run_payroll(
        &pool,
        &tenant,
        &pay_period,
        &period,
        can_see_amounts(&actor_role),
    )
    .await
}

// ---------------------------------------------------------------------------
// Bahşiş havuzu
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_tip_entries(
    period: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<tip_service::TipEntry>, String> {
    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    tip_service::list_entries(&pool, &tenant, &period).await
}

/// Yanlış girilen bahşişi siler; silinen tutar denetim defterinde kalır.
#[tauri::command]
pub async fn delete_tip_entry(
    entry_id: String,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let amount_cents = tip_service::delete_entry(&pool, &tenant, &entry_id).await?;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.begin_write().await.map_err(|e| e.to_string())?;
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        crate::services::audit_service::category::FINANS,
        "tip:deleted",
        entry_id,
        serde_json::json!({ "amountCents": amount_cents }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    conn.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

const TIP_WRITERS: [crate::rbac::Role; 3] = [
    crate::rbac::Role::Owner,
    crate::rbac::Role::Manager,
    crate::rbac::Role::Cashier,
];

pub mod tip_recipients;

/// Bahşişi alındığı yöntemle seçilen alıcıya yazar.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_tip_entry(
    amount_cents: i64,
    payment_method: String,
    recipient_user_id: Option<String>,
    request_id: Option<String>,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    state.lan_sync.require_local_write()?;
    crate::rbac::require_any(&actor_role, &TIP_WRITERS)?;
    let request_id = request_id
        .map(|id| uuid::Uuid::parse_str(&id).map(|key| key.to_string()))
        .transpose()
        .map_err(|_| "VALIDATION: Geçersiz bahşiş işlem kimliği.".to_string())?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let now = chrono::Local::now().to_rfc3339();
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.begin_write().await.map_err(|e| e.to_string())?;
    let (id, inserted) = tip_service::insert_tip(
        &mut conn,
        &tenant,
        None,
        amount_cents,
        &payment_method,
        &now,
        recipient_user_id.as_deref(),
        request_id.as_deref(),
    )
    .await?;
    if !inserted {
        return Ok(id);
    }
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        crate::services::audit_service::category::FINANS,
        "tip:recorded",
        id.clone(),
        serde_json::json!({ "amountCents": amount_cents, "recipientUserId": recipient_user_id, "paymentMethod": payment_method }),
        now,
    )?;
    crate::services::audit_service::AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    conn.commit().await?;
    Ok(id)
}

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
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<TipAllocation>, String> {
    state.lan_sync.require_local_write()?;
    // Dağıtım para hareketidir: müdür göremez, yalnız sahibi dağıtabilir.
    crate::rbac::require_owner(&actor_role)?;
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

/// Kişi kartı: dönem avansları ve bahşişi. Tutar olduğu için yalnız maaş yetkisiyle.
#[tauri::command]
pub async fn get_staff_money_summary(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: String,
    period: String,
    pool: State<'_, DbPool>,
) -> Result<crate::services::staff360::payroll_deductions::StaffMoneySummary, String> {
    crate::rbac::require_owner(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::staff360::payroll_deductions::money_summary(
        &mut conn, &tenant, &user_id, &period,
    )
    .await
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
