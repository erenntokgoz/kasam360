//! Modifier (seçenek & ekstra) yönetim komutları.
//!
//! Bu komutlar `CategoryForm` ve `ProductForm` içindeki "Seçenekler & Ekstralar"
//! alanlarından çağrılır. Faz 4 öncesinde bağımsız bir OWNER sekmesi
//! (`OwnerModifiersTab`) vardı; veri ve komutlar aynıdır, yalnız yönetim
//! yüzeyi forma gömüldü.
//!
//! Güvenlik (Faz 4 düzeltmesi): her komut `tenant_id` ile filtreler.
//! Önceden `get_modifier_groups` tüm işletmelerin gruplarını döndürüyor,
//! `delete_modifier_group` ise yalnız `id` üzerinden siliyordu — çapraz işletme
//! veri sızıntısı ve veri kaybı mümkündü.

use sqlx::Acquire;

use crate::db::DbPool;
use crate::management_commands::{audit_actor, record_audit};
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};
use crate::services::modifier_service;

/// Çağıranın tenant'ı zorunludur: eksik veya boşsa fail-closed reddedilir.
fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

#[tauri::command]
pub async fn get_modifier_groups(
    actor_role: String,
    tenant_id: Option<String>,
    category_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<modifier_service::ModifierGroupDto>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    modifier_service::list_groups(&mut conn, &tid, category_id.as_deref()).await
}

#[tauri::command]
pub async fn create_modifier_group(
    actor_role: String,
    name: String,
    is_required: bool,
    min_selections: i64,
    max_selections: Option<i64>,
    tenant_id: Option<String>,
    category_id: Option<String>,
    actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    let id = modifier_service::create_group(
        &mut tx,
        &tid,
        &name,
        is_required,
        min_selections,
        max_selections,
        category_id.as_deref(),
    )
    .await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::MENU,
        "menu:modifier_group_created",
        &id,
        serde_json::json!({
            "name": name.trim(),
            "isRequired": is_required,
            "minSelections": min_selections,
            "maxSelections": max_selections,
            "categoryId": category_id,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn add_modifier_option(
    actor_role: String,
    group_id: String,
    name: String,
    price_cents: i64,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Servis, grubun çağıranın tenant'ına ait olduğunu doğrular.
    let id =
        modifier_service::add_option(&mut tx, &tid, &group_id, &name, price_cents).await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::MENU,
        "menu:modifier_option_added",
        &id,
        serde_json::json!({
            "groupId": group_id,
            "name": name.trim(),
            "priceCents": price_cents,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_modifier_group(
    actor_role: String,
    group_id: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Servis silmeyi tenant'a göre filtreler; başka işletmenin grubu
    // bulunamadı sayılır ve silinmez.
    let previous_name = modifier_service::delete_group(&mut tx, &tid, &group_id).await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::MENU,
        "menu:modifier_group_deleted",
        &group_id,
        serde_json::json!({ "name": previous_name }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Ürünün bağlı olduğu modifier gruplarını **değiştirir** (küme semantiği).
///
/// Faz öncesinde bu bağlantı kurulamıyordu: `product_modifier_groups` tablosu
/// şemada vardı ama hiçbir komut yazmadığı için POS'ta modifier penceresi
/// hiç açılmıyordu.
#[tauri::command]
pub async fn set_product_modifier_groups(
    actor_role: String,
    product_id: String,
    group_ids: Vec<String>,
    tenant_id: Option<String>,
    actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    let previous = modifier_service::product_group_ids(&mut tx, &tid, &product_id).await?;
    modifier_service::set_product_groups(&mut tx, &tid, &product_id, &group_ids).await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::MENU,
        "menu:product_modifier_groups_set",
        &product_id,
        serde_json::json!({ "previous": previous, "current": group_ids }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Ürüne bağlı grup kimlikleri (ProductForm yüzeyi bunu okur).
#[tauri::command]
pub async fn get_product_modifier_group_ids(
    actor_role: String,
    product_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<String>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tid = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    modifier_service::product_group_ids(&mut conn, &tid, &product_id).await
}
