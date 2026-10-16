//! Tedarikçi, muhasebe, teknik servis ve kuyruk Tauri komutları.
//!
//! Neden ayrı modül: external360_commands.rs 500 satır tavanını aştığı için
//! operasyonel dış aktör komutları bu alt modüle ayrıldı.

use super::helpers::denetle;
use crate::commands::command_helpers::{audit_actor, require_tenant_id};
use crate::rbac::{require_any, Role};
use crate::services::audit_service::AuditLock;
use crate::services::external360::{accountant, queues, supplier, tickets};
use crate::DbPool;
use tauri::State;

// ---- tedarikçi ----

/// Tedarikçi sipariş talebi oluşturur.
#[tauri::command]
pub async fn supplier_request_create(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    supplier_id: String,
    items: String,
    note: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    supplier::talep_olustur(
        &mut conn,
        Some(&tenant),
        &supplier_id,
        &items,
        note.as_deref().unwrap_or(""),
    )
    .await
}

/// Talebi imzalı dosya olarak dışa aktarır (tedarikçiye verilecek dosya).
#[tauri::command]
pub async fn supplier_request_export(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    request_id: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let belge = supplier::talep_disa_aktar(&mut conn, Some(&tenant), &request_id).await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "supplier:exported",
        &request_id,
        serde_json::json!({ "key_id": belge.key_id }),
    )
    .await?;

    serde_json::to_string(&belge).map_err(|e| e.to_string())
}

/// Talebi WhatsApp kuyruğuna alır.
#[tauri::command]
pub async fn supplier_request_queue(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    request_id: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let kuyruk_id = supplier::talep_kuyruga_al(&mut conn, &tenant, &request_id).await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "supplier:queued",
        &request_id,
        serde_json::json!({ "kuyruk": kuyruk_id }),
    )
    .await?;

    Ok(kuyruk_id)
}

// ---- mali müşavir ----

/// Dönem raporu üretir (yalnız işletme sahibi).
#[tauri::command]
pub async fn accountant_report_build(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    period_start: String,
    period_end: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rapor = accountant::rapor_uret(
        &mut conn,
        Some(&tenant),
        &period_start,
        &period_end,
        &actor.0,
    )
    .await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "accountant:report_built",
        &rapor.id,
        serde_json::json!({
            "donem_baslangic": period_start,
            "donem_bitis": period_end,
            "tahsilat_cents": rapor.govde.govde.tahsilat_cents,
        }),
    )
    .await?;

    serde_json::to_string(&rapor.govde).map_err(|e| e.to_string())
}

/// Raporu müşavire iletildi olarak işaretler.
#[tauri::command]
pub async fn accountant_report_mark_sent(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    report_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    accountant::rapor_gonderildi_isaretle(&mut conn, &tenant, &report_id).await
}

// ---- teknik servis ----

/// Servis kaydı açar.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn service_ticket_create(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    category: String,
    severity: String,
    title: String,
    description: Option<String>,
    assigned_to: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::kayit_ac(
        &mut conn,
        Some(&tenant),
        &category,
        &severity,
        &title,
        description.as_deref().unwrap_or(""),
        assigned_to.as_deref(),
    )
    .await
}

/// Servis kaydının durumunu ilerletir.
#[tauri::command]
pub async fn service_ticket_update_status(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    ticket_id: String,
    status: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::durum_guncelle(&mut conn, &tenant, &ticket_id, &status).await
}

/// Açık servis kayıtlarını listeler.
#[tauri::command]
pub async fn service_tickets_open(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<(String, String, String)>, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::acik_kayitlar(&mut conn, &tenant).await
}

// ---- kuyruklar ----

/// Bekleyen WhatsApp ve e-posta mesajlarını sahte sağlayıcıyla gönderir.
#[tauri::command]
pub async fn outbound_queues_flush(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<(i64, i64), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let w = queues::whatsapp_kuyrugunu_isle(&mut conn, Some(&tenant)).await?;
    let e = queues::email_kuyrugunu_isle(&mut conn, Some(&tenant)).await?;
    Ok((w.gonderilen + w.basarisiz, e.gonderilen + e.basarisiz))
}

/// Kuyrukların bekleyen sayısını döndürür.
#[tauri::command]
pub async fn outbound_queues_pending(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<(i64, i64), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queues::bekleyen_sayi(&mut conn, &tenant).await
}
