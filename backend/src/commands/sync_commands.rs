//! Yerel ağ eşitlemesi komutları.
//!
//! Eşleştirme ve pasife alma yalnız işletme sahibine açıktır: ikisi de hangi
//! cihazın finansal kayıt yazabileceğini değiştirir.

use crate::ledger_commands::guard::require_ledger_tenant;
use crate::rbac::{self, Role};
use crate::services::lan_sync::conflicts::{self, SyncConflict};
use crate::services::lan_sync::runtime::sync_port;
use crate::services::lan_sync::{OperationOutcome, SyncStatus};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCodeDto {
    pub code: String,
    pub expires_at: String,
}

/// Dış ağa paket göndermeden çıkış arayüzünün adresini bulur.
fn local_ip() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket
        .connect("192.0.2.1:9")
        .map_err(|_| "NO_CONNECTION: yerel ağ adresi bulunamadı".to_string())?;
    Ok(socket
        .local_addr()
        .map_err(|e| e.to_string())?
        .ip()
        .to_string())
}

/// Bütün roller durum çubuğunu görür; içerikte gizli veri yoktur.
#[tauri::command]
pub async fn get_sync_status(
    actor_role: Option<String>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SyncStatus, String> {
    rbac::require_any_present(
        actor_role.as_deref(),
        &[
            Role::Owner,
            Role::Manager,
            Role::Cashier,
            Role::Waiter,
            Role::Kitchen,
        ],
    )?;
    Ok(state.lan_sync.status())
}

/// Tek kullanımlık eşleştirme kodu üretir; gerekirse kümeyi başlatır.
#[tauri::command]
pub async fn create_pairing_code(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    device_name: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PairingCodeDto, String> {
    rbac::require_any_present(actor_role.as_deref(), &[Role::Owner])?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let (code, expires_at) = state
        .lan_sync
        .create_pairing_code(&tid, device_name.trim(), &local_ip()?, sync_port())
        .await?;
    Ok(PairingCodeDto { code, expires_at })
}

/// Cihazı planlı olarak üyelikten çıkarır.
#[tauri::command]
pub async fn set_device_passive(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    device_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<OperationOutcome, String> {
    let role = actor_role.clone();
    rbac::require_any_present(role.as_deref(), &[Role::Owner])?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let actor = actor_id.ok_or_else(|| "UNAUTHORIZED: actor_id is required".to_string())?;
    state
        .lan_sync
        .set_device_passive(&tid, &device_id, &actor, "OWNER")
        .await
}

/// Diğer cihazlar kalıcı olarak kaybolduysa bu cihazla devam eder.
///
/// PIN yeniden istenir: oturumu açık bırakılmış kasada tek dokunuşla çoğunluk kuralı
/// kaldırılamaz. Kapalı cihaz sonradan açılırsa kümeye dönmez, yeniden eşleştirilir.
#[tauri::command]
pub async fn take_over_device(
    pin: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, crate::db::DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<OperationOutcome, String> {
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let owner =
        crate::commands::auth_commands::authenticate_by_pin(&pool, &pin, Some(&tid)).await?;
    rbac::require_any(&owner.role, &[Role::Owner])?;
    state.lan_sync.take_over(&tid, &owner.id, &owner.role).await
}

/// Birleşme çakışmaları. Para ve stok ayrıntısı taşıdığı için yalnız yönetime açıktır.
#[tauri::command]
pub async fn list_sync_conflicts(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pending_only: Option<bool>,
    pool: tauri::State<'_, crate::db::DbPool>,
) -> Result<Vec<SyncConflict>, String> {
    rbac::require_any_present(actor_role.as_deref(), &[Role::Owner, Role::Manager])?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    conflicts::list(&pool, &tid, pending_only.unwrap_or(true)).await
}

/// Çakışmayı notla kapatır; satırlara dokunmaz, düzeltme iade/sayım akışıyla yapılır.
#[tauri::command]
pub async fn resolve_sync_conflict(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    conflict_id: String,
    note: String,
    pool: tauri::State<'_, crate::db::DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let role = rbac::require_any_present(actor_role.as_deref(), &[Role::Owner, Role::Manager])?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let actor = actor_id.ok_or_else(|| "UNAUTHORIZED: actor_id is required".to_string())?;
    conflicts::resolve(
        &pool,
        &state.audit_mutex,
        &tid,
        conflict_id.trim(),
        &actor,
        role.as_str(),
        &note,
    )
    .await
}
