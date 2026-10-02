//! Faz 8 — Rezervasyon komutları.
//!
//! Yetki modeli (AGENTS.md §6):
//! - Rezervasyon yazma (**rezerve et / kaldır / müşteri geldi / gelmedi**)
//!   yalnız **WAITER, MANAGER, OWNER** içindir. Kasa ve mutfak rezervasyon
//!   yönetmez; MASTER platform işletmecisidir ve salon ekranına giremez.
//! - Okuma aynı üç role açıktır: garson rezervasyon defterini görmelidir ki
//!   "bu masa boş mu, rezerve mi" sorusunu masa kartından cevaplayabilsin.
//!
//! Tenant kapısı: `caller_tenant_id` **oturumdan** gelir ve zorunludur. İstek
//! `tenant_id` ile başka bir işletmeyi hedeflerse istek reddedilir; rezervasyon
//! yazmak platform işi değildir, MASTER istisnası tanınmaz.
//!
//! Denetim: her mutasyon `audit_ledger`'a **aynı transaction içinde** yazılır.
//! Rezervasyon kaydı silinmez (iptal/gelmedi terminalleri), dolayısıyla geçmiş
//! yalnız denetim defterinden değil, `reservations` tablosundan da okunabilir.

use serde::Deserialize;

use crate::db::DbPool;
use crate::management_commands::{audit_actor, record_audit};
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};
use crate::services::reservation_service::{self, NewReservation, ReservationDto};

/// Rezervasyon yönetebilen roller: masa ve sipariş sahibi olan roller.
fn require_reservation_manager(role: Option<&str>) -> Result<(), String> {
    rbac::require_any_present(role, &[Role::Owner, Role::Manager, Role::Waiter])?;
    Ok(())
}

fn resolve_tenant(session: Option<&str>, requested: Option<&str>) -> Result<String, String> {
    let own = session
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;
    if let Some(target) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        if target != own {
            return Err("FORBIDDEN: başka bir işletmenin rezervasyonuna erişilemez".to_string());
        }
    }
    Ok(own)
}

fn require_text(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("INVALID_ARGUMENT: {} zorunludur", field))
    } else {
        Ok(trimmed.to_string())
    }
}

/// Rezervasyon isteği gövdesi.
#[derive(Debug, Deserialize)]
pub struct ReserveTableRequest {
    #[serde(alias = "tableId")]
    pub table_id: String,
    #[serde(alias = "customerName")]
    pub customer_name: String,
    #[serde(alias = "customerPhone", default)]
    pub customer_phone: Option<String>,
    #[serde(alias = "partySize", default = "default_party_size")]
    pub party_size: i64,
    #[serde(alias = "reservedAt")]
    pub reserved_at: String,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_party_size() -> i64 {
    1
}

/// Salon planında görünen açık rezervasyonlar.
#[tauri::command]
pub async fn get_reservations(
    caller_role: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ReservationDto>, String> {
    require_reservation_manager(caller_role.as_deref())?;
    let tenant = resolve_tenant(caller_tenant_id.as_deref(), tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    reservation_service::list_open(&mut conn, &tenant).await
}

/// Bir günün rezervasyon günlüğü (kapalı kayıtlar dâhil).
///
/// Neden ayrı komut: salon planı yalnız açık kayıtları gösterir; "bugün kaç
/// rezervasyon vardı, kaçı gelmedi" sorusu yalnız günlükten yanıtlanır.
#[tauri::command]
pub async fn get_reservation_day(
    caller_role: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    day: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ReservationDto>, String> {
    require_reservation_manager(caller_role.as_deref())?;
    let tenant = resolve_tenant(caller_tenant_id.as_deref(), tenant_id.as_deref())?;
    let prefix = require_text(&day, "day")?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    reservation_service::list_day(&mut conn, &tenant, &prefix).await
}

/// Boş masayı rezerve eder.
///
/// Neden eski komutun yerini alıyor: eski `reserve_table` durum ön-koşulu
/// taşımadığı için **dolu masayı rezerve edebiliyor** ve açık adisyonu sessizce
/// kaybediyordu. Artık ön koşul servis katmanında ve kısmi tekil indekstedir.
#[tauri::command]
pub async fn reserve_table(
    request: ReserveTableRequest,
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ReservationDto, String> {
    require_reservation_manager(caller_role.as_deref())?;
    let tenant = resolve_tenant(caller_tenant_id.as_deref(), tenant_id.as_deref())?;
    let table_id = require_text(&request.table_id, "tableId")?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, caller_role.as_deref().unwrap_or("WAITER"));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let reservation = reservation_service::create(
        &mut tx,
        &tenant,
        &table_id,
        &actor_id,
        &actor_role,
        NewReservation {
            customer_name: request.customer_name,
            customer_phone: request.customer_phone,
            party_size: request.party_size,
            reserved_at: request.reserved_at,
            note: request.note,
        },
    )
    .await?;

    record_audit(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        &actor_role,
        category::SIPARIS_MASA,
        "table:reserved",
        &table_id,
        serde_json::json!({
            "reservationId": reservation.id,
            "tableId": table_id,
            "tableName": reservation.table_name,
            "customerName": reservation.customer_name,
            "partySize": reservation.party_size,
            "reservedAt": reservation.reserved_at,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(reservation)
}

async fn close_with_reason(
    reservation_id: String,
    reason: Option<String>,
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ReservationDto, String> {
    require_reservation_manager(caller_role.as_deref())?;
    let tenant = resolve_tenant(caller_tenant_id.as_deref(), tenant_id.as_deref())?;
    let id = require_text(&reservation_id, "reservationId")?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, caller_role.as_deref().unwrap_or("WAITER"));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let reservation = reservation_service::cancel(
        &mut tx,
        &tenant,
        &id,
        &actor_id,
        reason.as_deref(),
    )
    .await?;

    record_audit(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        &actor_role,
        category::SIPARIS_MASA,
        if reservation.status == "NO_SHOW" {
            "table:reservation_no_show"
        } else {
            "table:reservation_cancelled"
        },
        &reservation.table_id,
        serde_json::json!({
            "reservationId": reservation.id,
            "tableId": reservation.table_id,
            "status": reservation.status,
            "reason": reservation.close_reason,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(reservation)
}

/// Rezervasyonu kaldırır ve masayı boşaltır.
#[tauri::command]
pub async fn cancel_reservation(
    reservation_id: String,
    reason: Option<String>,
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ReservationDto, String> {
    close_with_reason(
        reservation_id,
        reason,
        caller_role,
        caller_id,
        caller_tenant_id,
        tenant_id,
        pool,
        app_state,
    )
    .await
}

/// Rezervasyonu "müşteri gelmedi" olarak kapatır.
///
/// Neden ayrı komut: vazgeçme ile gelmeme **iki ayrı operasyonel gerçektir**;
/// raporda "boş kalan masa" ile "gelmeyen misafir" ayrımı bu yüzden korunur.
#[tauri::command]
pub async fn mark_reservation_no_show(
    reservation_id: String,
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ReservationDto, String> {
    close_with_reason(
        reservation_id,
        Some("NO_SHOW".to_string()),
        caller_role,
        caller_id,
        caller_tenant_id,
        tenant_id,
        pool,
        app_state,
    )
    .await
}

/// "Müşteri Geldi": rezervasyon `ARRIVED` olur, masa `RESERVED` kalır.
///
/// Neden `OCCUPIED` değil: müşteri geldiği ile adisyon açıldığı iki ayrı gerçektir.
/// Masa ancak sipariş gönderildiğinde işgal edilir (`seat_for_order`).
#[tauri::command]
pub async fn mark_reservation_arrived(
    reservation_id: String,
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ReservationDto, String> {
    require_reservation_manager(caller_role.as_deref())?;
    let tenant = resolve_tenant(caller_tenant_id.as_deref(), tenant_id.as_deref())?;
    let id = require_text(&reservation_id, "reservationId")?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, caller_role.as_deref().unwrap_or("WAITER"));
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let reservation =
        reservation_service::mark_arrived(&mut tx, &tenant, &id, &actor_id).await?;

    record_audit(
        &mut tx,
        &lock,
        &tenant,
        &actor_id,
        &actor_role,
        category::SIPARIS_MASA,
        "table:reservation_arrived",
        &reservation.table_id,
        serde_json::json!({
            "reservationId": reservation.id,
            "tableId": reservation.table_id,
            "customerName": reservation.customer_name,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(reservation)
}
