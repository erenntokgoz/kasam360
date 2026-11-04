//! Personel izin komutları.

use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use crate::services::staff360::staff_service;
use crate::services::staff360::staff_types::{LeaveInput, LeaveRequest};
use tauri::State;

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

/// Sahip veya müdürün başkası için girdiği izin karardır, talep değildir; onay istemez.
#[tauri::command]
pub async fn request_leave(
    tenant_id: Option<String>,
    actor_id: Option<String>,
    actor_role: String,
    input: LeaveInput,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    crate::rbac::require_leave_request(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let can_decide = crate::rbac::require_staff_admin(&actor_role).is_ok();
    let approver = actor_id.filter(|id| can_decide && *id != input.user_id);
    staff_service::request_leave(&pool, &tenant, &input, approver.as_deref()).await
}

#[tauri::command]
pub async fn update_leave(
    tenant_id: Option<String>,
    actor_role: String,
    leave_id: String,
    input: LeaveInput,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::update_leave(&pool, &tenant, &leave_id, &input).await
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

/// İzni listeden kaldırır. Kayıt `Iptal` durumuna geçer; bordroda izin sayılmaz.
#[tauri::command]
pub async fn delete_leave(
    tenant_id: Option<String>,
    actor_role: String,
    leave_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_staff_admin(&actor_role)?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    staff_service::cancel_leave(&pool, &tenant, &leave_id).await
}
