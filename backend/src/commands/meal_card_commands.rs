//! Yemek kartı marka ayarı ve mutabakat komutları.
//!
//! Neden ince kapı: rol, kiracı ve aralık doğrulaması burada, SQL `services`
//! altında kalır.

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{require_any_present, Role};
use crate::services::lan_sync::WritePool;
use crate::services::meal_cards::{self, ProviderSetting, Reconciliation};

/// Ödeme ekranı markaları kasiyerden de okur.
const READ_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];
/// Hangi markanın kabul edildiği ve mutabakat yönetim verisidir.
const MANAGEMENT_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

#[tauri::command]
pub async fn list_meal_card_providers(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ProviderSetting>, String> {
    require_any_present(actor_role.as_deref(), &READ_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    meal_cards::list_settings(&mut conn, &tenant).await
}

#[tauri::command]
pub async fn set_meal_card_provider_enabled(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    code: String,
    enabled: bool,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<ProviderSetting>, String> {
    state.lan_sync.require_local_write()?;
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut tx = pool.begin_write().await?;
    let settings = meal_cards::set_enabled(&mut tx, &tenant, &code, enabled).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub async fn get_meal_card_reconciliation(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    from: String,
    to: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Reconciliation, String> {
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let parse = |value: &str, field: &str| {
        chrono::DateTime::parse_from_rfc3339(value.trim())
            .map_err(|_| format!("INVALID_ARGUMENT: {field} ISO-8601 olmalı"))
    };
    if parse(&to, "to")? < parse(&from, "from")? {
        return Err("INVALID_ARGUMENT: to, from değerinden önce olamaz".to_string());
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    meal_cards::reconciliation(&mut conn, &tenant, &from, &to).await
}
