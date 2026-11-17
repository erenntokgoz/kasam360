//! e-Adisyon ayarları ve e-Belge kuyruğu komutları.
//!
//! Neden ince kapı: rol ve kiracı doğrulaması burada, belge üretimi ve gönderim
//! `services::e_document` altında kalır. Ayar yazmak yalnız işletme sahibine, kuyruk
//! işlemleri sahibe ve müdüre açıktır; kasa ve salon rolleri belge görmez.

use serde::Serialize;

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{require_any_present, Role};
use crate::services::audit_service::AuditLock;
use crate::services::e_document::dispatcher::{self, Actor, DispatchReport};
use crate::services::e_document::provider::runtime_provider;
use crate::services::e_document::queue::{self, Candidate, QueueCounts, QueueEntry};
use crate::services::e_document::settings::{self, EDocumentSettings};
use crate::services::lan_sync::WritePool;

const SETTINGS_WRITE_ROLES: [Role; 1] = [Role::Owner];
const QUEUE_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EDocumentOverview {
    pub enabled: bool,
    /// Gerçek bir sağlayıcı bağlı değilse arayüz kalıcı uyarı gösterir.
    pub provider_configured: bool,
    pub counts: QueueCounts,
}

#[tauri::command]
pub async fn get_e_document_settings(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<EDocumentSettings, String> {
    require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    settings::get(&mut conn, &tenant).await
}

#[tauri::command]
pub async fn save_e_document_settings(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    settings: EDocumentSettings,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<EDocumentSettings, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &SETTINGS_WRITE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let saved =
        settings::save(&mut tx, &lock, &tenant, &actor_id, role.as_str(), &settings).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub async fn get_e_document_overview(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<EDocumentOverview, String> {
    require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    Ok(EDocumentOverview {
        enabled: settings::get(&mut conn, &tenant).await?.enabled,
        provider_configured: runtime_provider().is_configured(),
        counts: queue::counts(&mut conn, &tenant).await?,
    })
}

#[tauri::command]
pub async fn list_e_documents(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<QueueEntry>, String> {
    require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::list(&mut conn, &tenant, status.as_deref(), limit.unwrap_or(200)).await
}

#[tauri::command]
pub async fn list_e_document_candidates(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<Candidate>, String> {
    require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::candidates(&mut conn, &tenant, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn get_e_document_xml(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    document_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<String, String> {
    require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::get_xml(&mut conn, &tenant, document_id.trim()).await
}

#[tauri::command]
pub async fn create_e_document_draft(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    order_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<QueueEntry, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let entry = queue::create_draft(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        role.as_str(),
        order_id.trim(),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Taslak yeniden kurma, gönderilecek yapma ve yeniden deneme tek kapıdan geçer.
async fn move_document(
    actor_id: &str,
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
    document_id: &str,
    action: &str,
    pool: &DbPool,
    state: &crate::AppState,
) -> Result<QueueEntry, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role, &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id)?;
    let lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let id = document_id.trim();
    let entry = match action {
        "rebuild" => {
            queue::rebuild_draft(&mut tx, &lock, &tenant, actor_id, role.as_str(), id).await
        }
        "submit" => queue::submit(&mut tx, &lock, &tenant, actor_id, role.as_str(), id).await,
        _ => queue::retry(&mut tx, &lock, &tenant, actor_id, role.as_str(), id).await,
    }?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command]
pub async fn rebuild_e_document_draft(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    document_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<QueueEntry, String> {
    move_document(
        &actor_id,
        actor_role.as_deref(),
        tenant_id.as_deref(),
        &document_id,
        "rebuild",
        &pool,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn submit_e_document(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    document_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<QueueEntry, String> {
    move_document(
        &actor_id,
        actor_role.as_deref(),
        tenant_id.as_deref(),
        &document_id,
        "submit",
        &pool,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn retry_e_document(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    document_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<QueueEntry, String> {
    move_document(
        &actor_id,
        actor_role.as_deref(),
        tenant_id.as_deref(),
        &document_id,
        "retry",
        &pool,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn dispatch_e_documents(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DispatchReport, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = Actor {
        tenant_id: &tenant,
        id: &actor_id,
        role: role.as_str(),
    };
    let provider = runtime_provider();
    dispatcher::dispatch_pending(&pool, &state.audit_mutex, provider.as_ref(), &actor, 50).await
}

#[tauri::command]
pub async fn refresh_e_document_status(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    document_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<QueueEntry, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &QUEUE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = Actor {
        tenant_id: &tenant,
        id: &actor_id,
        role: role.as_str(),
    };
    let provider = runtime_provider();
    dispatcher::refresh_status(
        &pool,
        &state.audit_mutex,
        provider.as_ref(),
        &actor,
        document_id.trim(),
    )
    .await
}
