//! Personel hesabı ve personel borcu komutları.
//!
//! Ekran erişimi (`require_staff_admin`) ile tutar görünürlüğü (`require_payroll_amounts`)
//! ve para çıkışı yetkisi ayrıdır: müdür hesapları ve borcu görebilir, ödeme ise sahip
//! onay jetonu gerektirir.

use crate::services::audit_service;
use crate::services::lan_sync::WritePool;
use crate::services::staff360::staff_settlement::{
    self, PayActor, PayRequest, SettlementPayment, StaffDebt, StaffSettlement,
};
use crate::DbPool;
use tauri::State;

fn require_tenant_scope(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id zorunludur".to_string())
}

fn amounts_visible(actor_role: &str) -> bool {
    crate::rbac::require_payroll_amounts(actor_role).is_ok()
}

/// Kişinin (verilmezse tüm işletmenin) çıkış hesapları.
#[tauri::command]
pub async fn list_staff_settlements(
    tenant_id: Option<String>,
    actor_role: String,
    user_id: Option<String>,
    only_open: Option<bool>,
    pool: State<'_, DbPool>,
) -> Result<Vec<StaffSettlement>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    staff_settlement::list(
        &mut conn,
        &tenant,
        user_id.as_deref(),
        only_open.unwrap_or(false),
        amounts_visible(&actor_role),
    )
    .await
}

/// Kişi başına açık personel borcu.
#[tauri::command]
pub async fn get_staff_debts(
    tenant_id: Option<String>,
    actor_role: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<StaffDebt>, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    staff_settlement::debts(&mut conn, &tenant, amounts_visible(&actor_role)).await
}

/// Hesaba ödeme. `requestId` aynı niyet için sabit kalır; tekrar gönderim ikinci gider
/// yazmaz. Sahip doğrudan, müdür sahip onay jetonuyla ödeyebilir.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pay_staff_settlement(
    tenant_id: Option<String>,
    actor_id: String,
    actor_role: String,
    settlement_id: String,
    amount_cents: i64,
    payment_method: String,
    request_id: String,
    approval_token: Option<String>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<SettlementPayment, String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    state.lan_sync.require_local_write()?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let payment = staff_settlement::pay(
        &mut tx,
        &audit_lock,
        &tenant,
        &PayActor {
            id: &actor_id,
            role: &actor_role,
            approval_token: approval_token.as_deref(),
        },
        &PayRequest {
            settlement_id: &settlement_id,
            amount_cents,
            payment_method: &payment_method,
            request_id: &request_id,
        },
        &chrono::Utc::now().to_rfc3339(),
    )
    .await?;
    tx.commit().await?;
    Ok(payment)
}
