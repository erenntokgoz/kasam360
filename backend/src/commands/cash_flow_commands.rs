//! Kapanan masalar, gün sonu arşivi ve para hesapları komutları.
//!
//! Neden tek dosya: üçü de yalnız servis çağıran ince kapılardır; rol, kiracı
//! ve aralık doğrulaması burada, SQL `services` altında kalır.

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{require_any_present, Role};
use crate::services::closed_orders::{self, ClosedOrderDetail, ClosedOrderFilter, ClosedOrderList};
use crate::services::day_close_archive::{self, DayCloseDetail, DayCloseRow};
use crate::services::lan_sync::WritePool;
use crate::services::money_accounts::{self, AccountTransfer, FlowEntry, MoneyAccount};

/// Kapanan masalar kasa ekranıdır: garson ve mutfak göremez.
const CLOSED_ORDER_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];
/// Arşiv ve hesaplar yönetim verisidir.
const MANAGEMENT_ROLES: [Role; 2] = [Role::Owner, Role::Manager];
/// Hesap tanımı ve transfer para hareketidir; yalnız işletme sahibi.
const ACCOUNT_WRITE_ROLES: [Role; 1] = [Role::Owner];

/// Tarih aralığı zorunludur ve ters olamaz: ters aralık sessizce "kayıt yok"
/// görünürdü.
fn require_range(from: &str, to: &str) -> Result<(), String> {
    let parse = |value: &str, field: &str| {
        chrono::DateTime::parse_from_rfc3339(value.trim())
            .map_err(|_| format!("INVALID_ARGUMENT: {field} ISO-8601 olmalı"))
    };
    if parse(to, "to")? < parse(from, "from")? {
        return Err("INVALID_ARGUMENT: to, from değerinden önce olamaz".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_closed_orders(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    filter: ClosedOrderFilter,
    pool: tauri::State<'_, DbPool>,
) -> Result<ClosedOrderList, String> {
    require_any_present(actor_role.as_deref(), &CLOSED_ORDER_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    require_range(&filter.from, &filter.to)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    closed_orders::list(&mut conn, &tenant, &filter).await
}

#[tauri::command]
pub async fn get_closed_order_detail(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    order_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<ClosedOrderDetail, String> {
    require_any_present(actor_role.as_deref(), &CLOSED_ORDER_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    closed_orders::detail(&mut conn, &tenant, order_id.trim())
        .await?
        .ok_or_else(|| "NOT_FOUND: kapanmış adisyon bulunamadı".to_string())
}

#[tauri::command]
pub async fn list_day_closes(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DayCloseRow>, String> {
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    day_close_archive::list(&mut conn, &tenant, limit.unwrap_or(100)).await
}

#[tauri::command]
pub async fn get_day_close_detail(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    close_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DayCloseDetail, String> {
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    day_close_archive::detail(&mut conn, &tenant, close_id.trim())
        .await?
        .ok_or_else(|| "NOT_FOUND: gün sonu kaydı bulunamadı".to_string())
}

#[tauri::command]
pub async fn list_money_accounts(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<MoneyAccount>, String> {
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    money_accounts::list_accounts(&mut conn, &tenant).await
}

#[tauri::command]
pub async fn list_money_flow(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    from: String,
    to: String,
    limit: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<FlowEntry>, String> {
    require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    require_range(&from, &to)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    money_accounts::flow(&mut conn, &tenant, &from, &to, limit.unwrap_or(200)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_money_account(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    name: String,
    kind: String,
    opening_cents: i64,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<MoneyAccount, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &ACCOUNT_WRITE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let account = money_accounts::create_account(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        role.as_str(),
        &name,
        kind.trim(),
        opening_cents,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(account)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn set_money_account_active(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    account_id: String,
    active: bool,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<MoneyAccount, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &ACCOUNT_WRITE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let account = money_accounts::set_active(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        role.as_str(),
        account_id.trim(),
        active,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(account)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn transfer_between_accounts(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    transfer_id: String,
    from_account_id: String,
    to_account_id: String,
    amount_cents: i64,
    note: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<AccountTransfer, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &ACCOUNT_WRITE_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let transfer = money_accounts::transfer(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        role.as_str(),
        transfer_id.trim(),
        from_account_id.trim(),
        to_account_id.trim(),
        amount_cents,
        note.as_deref().unwrap_or(""),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(transfer)
}
