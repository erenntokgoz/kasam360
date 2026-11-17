//! Paket servis komutları: müşteri, sipariş, durum, kurye ve mutabakat.
//!
//! Neden ince kapılar: rol, kiracı ve bayrak denetimi burada; SQL `services::delivery`
//! altındadır. Bayrak kapalıysa her komut reddedilir (fail-closed). Yazan komutlar
//! `require_local_write` ve `begin_write` ile LAN/bulut yazma kapısından geçer.
//!
//! Yetki: sipariş ve müşteri işlerini sahip, müdür ve kasiyer yapar. Kurye etiketli kişi
//! başka rolle girer ve yalnız kendine atanmış siparişleri görür ve ilerletir.

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{require_any_present, Role};
use crate::services::delivery::couriers::{self, CourierRow};
use crate::services::delivery::customers::{
    self, AddressInput, CustomerInput, CustomerOrderRow, DeliveryCustomer,
};
use crate::services::delivery::orders::{self, CreatedDelivery, NewDelivery};
use crate::services::delivery::reports::{self, DeliveryReport};
use crate::services::delivery::settlement::{self, SettleInput, SettlementResult};
use crate::services::delivery::transitions::{self, Who};
use crate::services::delivery::{self, DeliveryRow};
use crate::services::lan_sync::WritePool;

/// Sipariş, müşteri ve atama işleri.
const STAFF_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];
/// Kurye etiketini ve raporu yönetim yapar.
const MANAGEMENT_ROLES: [Role; 2] = [Role::Owner, Role::Manager];
/// Kurye parasını kasaya işletme sahibi ve kasiyer alır; tahsilatla aynı kural.
const COLLECT_ROLES: [Role; 2] = [Role::Owner, Role::Cashier];
/// Kurye etiketli personel mutfak ve platform hesabı olamaz.
const COURIER_ROLES: [Role; 4] = [Role::Owner, Role::Manager, Role::Cashier, Role::Waiter];

/// Personel mi, kurye mi: ikisi de değilse reddedilir.
pub(crate) fn who_gate(actor_role: Option<&str>) -> Result<Option<Who>, String> {
    let role = require_any_present(actor_role, &COURIER_ROLES)?;
    Ok(STAFF_ROLES.contains(&role).then_some(Who::Staff))
}

fn require_actor(actor_id: &str) -> Result<String, String> {
    let id = actor_id.trim();
    if id.is_empty() {
        return Err("UNAUTHORIZED: actor_id is required".to_string());
    }
    Ok(id.to_string())
}

/// Tahta: personel tüm siparişleri, kurye yalnız kendine atananları görür.
#[tauri::command]
pub async fn list_delivery_board(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DeliveryRow>, String> {
    let who = who_gate(actor_role.as_deref())?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    delivery::require_enabled(&mut conn, &tenant).await?;
    match who {
        Some(_) => delivery::list_board(&mut conn, &tenant, None, 50).await,
        None => {
            if !couriers::is_courier(&mut conn, &tenant, &actor).await? {
                return Err("FORBIDDEN: kurye olarak tanımlı değilsiniz".to_string());
            }
            delivery::list_board(&mut conn, &tenant, Some(&actor), 20).await
        }
    }
}

#[tauri::command]
pub async fn list_delivery_customers(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    query: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DeliveryCustomer>, String> {
    require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    delivery::require_enabled(&mut conn, &tenant).await?;
    customers::search(&mut conn, &tenant, query.as_deref().unwrap_or("")).await
}

#[tauri::command]
pub async fn get_delivery_customer_history(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    customer_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CustomerOrderRow>, String> {
    require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    delivery::require_enabled(&mut conn, &tenant).await?;
    customers::history(&mut conn, &tenant, customer_id.trim(), 30).await
}

#[tauri::command]
pub async fn save_delivery_customer(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    input: CustomerInput,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryCustomer, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    delivery::require_enabled(&mut tx, &tenant).await?;
    let saved =
        customers::save_customer(&mut tx, &lock, &tenant, &actor, role.as_str(), &input).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub async fn save_delivery_address(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    input: AddressInput,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryCustomer, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    delivery::require_enabled(&mut tx, &tenant).await?;
    let saved =
        customers::save_address(&mut tx, &lock, &tenant, &actor, role.as_str(), &input).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub async fn remove_delivery_address(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    address_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryCustomer, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    delivery::require_enabled(&mut tx, &tenant).await?;
    let saved = customers::remove_address(
        &mut tx,
        &lock,
        &tenant,
        &actor,
        role.as_str(),
        address_id.trim(),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
pub async fn create_delivery_order(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    input: NewDelivery,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CreatedDelivery, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let created = orders::create(&mut tx, &lock, &tenant, &actor, role.as_str(), &input).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(created)
}

/// Durumu ilerletir. Ön ödemeli sipariş teslimde kapandığı için ödeme kilidi de alınır.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn advance_delivery(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    delivery_id: String,
    to_status: String,
    courier_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryRow, String> {
    state.lan_sync.require_local_write()?;
    let staff = who_gate(actor_role.as_deref())?;
    let role = require_any_present(actor_role.as_deref(), &COURIER_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let _payment = state.payment_mutex.lock().await;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    delivery::require_enabled(&mut tx, &tenant).await?;
    let who = match staff {
        Some(who) => who,
        None => {
            if !couriers::is_courier(&mut tx, &tenant, &actor).await? {
                return Err("FORBIDDEN: kurye olarak tanımlı değilsiniz".to_string());
            }
            Who::Courier
        }
    };
    let row = transitions::advance(
        &mut tx,
        &lock,
        &tenant,
        &actor,
        role.as_str(),
        who,
        delivery_id.trim(),
        &to_status,
        courier_id.as_deref(),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub async fn assign_delivery_courier(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    delivery_id: String,
    courier_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryRow, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let row = transitions::assign_courier(
        &mut tx,
        &lock,
        &tenant,
        &actor,
        role.as_str(),
        delivery_id.trim(),
        &courier_id,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(row)
}

/// İptal yönetici PIN onayı ister; jeton sipariş iptaliyle aynı yüzeyden tüketilir.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cancel_delivery(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    delivery_id: String,
    reason: String,
    approval_token: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DeliveryRow, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let _payment = state.payment_mutex.lock().await;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    delivery::require_enabled(&mut tx, &tenant).await?;
    let current = delivery::find_delivery(&mut tx, &tenant, delivery_id.trim()).await?;
    let request = crate::commands::void_commands::void_approval_request(
        &tenant,
        &current.order_id,
        current.total_cents,
        &actor,
        role.as_str(),
    );
    let approver = crate::commands::void_commands::require_void_approval(
        &mut tx,
        &request,
        approval_token.as_deref(),
    )
    .await?;
    let row = orders::cancel(
        &mut tx,
        &lock,
        &tenant,
        &actor,
        role.as_str(),
        delivery_id.trim(),
        &reason,
    )
    .await?;
    let consumed = crate::services::audit_service::AuditContext::new(
        tenant.clone(),
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "approval:consumed",
        current.order_id.clone(),
        serde_json::json!({
            "operation": crate::approval_service::operation::VOID,
            "amountCents": current.total_cents,
            "actorId": actor,
            "approverId": approver.approver_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &lock, &consumed).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub async fn list_delivery_couriers(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CourierRow>, String> {
    require_any_present(actor_role.as_deref(), &STAFF_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    delivery::require_enabled(&mut conn, &tenant).await?;
    couriers::list(&mut conn, &tenant).await
}

#[tauri::command]
pub async fn set_delivery_courier_flag(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    user_id: String,
    enabled: bool,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &MANAGEMENT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    couriers::set_flag(
        &mut tx,
        &lock,
        &tenant,
        &actor,
        role.as_str(),
        user_id.trim(),
        enabled,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn settle_delivery_courier(
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    input: SettleInput,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SettlementResult, String> {
    state.lan_sync.require_local_write()?;
    let role = require_any_present(actor_role.as_deref(), &COLLECT_ROLES)?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;
    let actor = require_actor(&actor_id)?;
    crate::services::setup::require_complete(&pool).await?;
    // Kilit sırası her yerde aynıdır: önce payment_mutex, sonra audit_mutex.
    let _payment = state.payment_mutex.lock().await;
    let lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let result =
        settlement::settle_courier(&mut tx, &lock, &tenant, &actor, role.as_str(), &input).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn get_delivery_report(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    from: String,
    to: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DeliveryReport, String> {
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
    delivery::require_enabled(&mut conn, &tenant).await?;
    reports::report(&mut conn, &tenant, from.trim(), to.trim()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rol_kapisi_personel_ve_kurye_ayirir() {
        for role in ["OWNER", "MANAGER", "CASHIER"] {
            assert_eq!(who_gate(Some(role)).unwrap(), Some(Who::Staff), "{role}");
        }
        assert_eq!(who_gate(Some("WAITER")).unwrap(), None);
        for role in ["KITCHEN", "MASTER", "x", ""] {
            assert!(who_gate(Some(role)).is_err(), "{role}");
        }
        assert!(who_gate(None).is_err());
    }
}
