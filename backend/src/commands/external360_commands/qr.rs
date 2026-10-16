//! QR Menü ve müşteri etkileşim Tauri komutları.
//!
//! Neden ayrı modül: external360_commands.rs 500 satır tavanını aştığı için
//! müşteri/QR komutları bu alt modüle ayrıldı.

use super::helpers::{denetle, require_qr_menu};
use crate::commands::command_helpers::{audit_actor, require_tenant_id};
use crate::rbac::{require_any, Role};
use crate::services::audit_service::AuditLock;
use crate::services::external360::{menu_file, qr_menu};
use crate::DbPool;
use tauri::State;

/// Müşteri oturumu açar (masa başından QR menü bağlantısı basılır).
#[tauri::command]
pub async fn qr_customer_session_open(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    customer_label: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<qr_menu::MusteriOturumu, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Waiter])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::oturum_ac(
        &mut conn,
        Some(&tenant),
        customer_label.as_deref().unwrap_or(""),
    )
    .await
}

/// Müşteri oturumunu iptal eder.
#[tauri::command]
pub async fn qr_customer_session_revoke(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    session_token: String,
    pool: State<'_, DbPool>,
) -> Result<bool, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::oturum_iptal(&mut conn, &tenant, &session_token).await
}

/// İmzalı statik menü dosyasını (JSON + HTML) üretir.
#[tauri::command]
pub async fn qr_menu_build(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<menu_file::ImzaliMenuCiktisi, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let cikti = menu_file::menu_dosyasi_uret(&mut conn, &tenant).await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "qr_menu:built",
        &cikti.key_id,
        serde_json::json!({ "urun_adedi": cikti.json.len() }),
    )
    .await?;

    Ok(cikti)
}

/// Bekleyen müşteri taleplerini listeler.
#[tauri::command]
pub async fn qr_pending_requests(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
) -> Result<Vec<(String, String, String)>, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::bekleyen_talepler(&mut conn, &tenant).await
}

/// Müşteri talebini mevcut siparişe bağlar.
#[tauri::command]
pub async fn qr_request_accept(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    request_id: String,
    order_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::talep_onayla(&mut conn, &tenant, &request_id, &order_id).await
}

/// Müşteri talebini reddeder.
#[tauri::command]
pub async fn qr_request_reject(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    request_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::talep_reddet(&mut conn, &tenant, &request_id).await
}

/// Müşteri geri bildirimini kaydeder.
#[tauri::command]
pub async fn qr_feedback_create(
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    session_token: String,
    rating: i64,
    comment: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    require_qr_menu(active_modules.as_ref())?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::geri_bildirim_kaydet(
        &mut conn,
        Some(&tenant),
        &session_token,
        rating,
        comment.as_deref().unwrap_or(""),
    )
    .await
}
