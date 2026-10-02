//! Vardiya komutları (aç, kapat, aktif, tarihçe)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;
use crate::commands::command_helpers::audit_actor;
use crate::commands::receipt_commands::require_tenant_scope;


#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDto {
    pub id: String,
    pub tenant_id: String,
    pub cashier_id: String,
    pub status: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub expected_amount_cents: i32,
    pub actual_amount_cents: Option<i32>,
    pub difference_cents: Option<i32>,
}

#[tauri::command]
pub async fn open_shift(
    cashier_id: String,
    expected_amount_cents: i32,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    // Check if open shift exists
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?")
        .bind(&cashier_id)
        .bind(&tenant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        
    if count > 0 {
        return Err("Vardiya zaten açık (Shift already open)".into());
    }
    
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) VALUES (?, ?, ?, 'OPEN', datetime('now'), ?)")
        .bind(&id)
        .bind(&tenant_id)
        .bind(&cashier_id)
        .bind(expected_amount_cents)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:opened",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "expectedAmountCents": expected_amount_cents,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
        
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "OPEN".into(),
        opened_at: chrono::Utc::now().to_rfc3339(),
        closed_at: None,
        expected_amount_cents,
        actual_amount_cents: None,
        difference_cents: None
    })
}

#[tauri::command]
pub async fn close_shift(
    cashier_id: String,
    actual_amount_cents: i32,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    // Find open shift
    let row = sqlx::query("SELECT id, expected_amount_cents, tenant_id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?")
        .bind(&cashier_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        
    let r = row.ok_or("Aktif açık vardiya bulunamadı (No active open shift found)")?;
    let id: String = r.try_get("id").unwrap_or_default();
    let expected: i32 = r.try_get("expected_amount_cents").unwrap_or(0);
    let shift_tenant: String = r
        .try_get("tenant_id")
        .unwrap_or_else(|_| tenant_id.clone());
    
    let difference = actual_amount_cents - expected;
    
    sqlx::query("UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'), actual_amount_cents = ?, difference_cents = ? WHERE id = ?")
        .bind(actual_amount_cents)
        .bind(difference)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Kasa kapanışı "Eski Değer → Yeni Değer" sütununun en kritik kaydıdır:
    // beklenen ile sayılan tutar ve fark burada görünür olur.
    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        shift_tenant,
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:closed",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "changes": {
                "expectedAmountCents": { "old": expected, "new": actual_amount_cents },
            },
            "differenceCents": difference,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
        
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "CLOSED".into(),
        opened_at: "".into(),
        closed_at: Some(chrono::Utc::now().to_rfc3339()),
        expected_amount_cents: expected,
        actual_amount_cents: Some(actual_amount_cents),
        difference_cents: Some(difference)
    })
}

#[tauri::command]
pub async fn get_active_shift(cashier_id: String, pool: tauri::State<'_, DbPool>) -> Result<Option<ShiftDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query("SELECT id, tenant_id, cashier_id, status, opened_at, expected_amount_cents FROM shifts WHERE cashier_id = ? AND status = 'OPEN'")
        .bind(&cashier_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = row {
        Ok(Some(ShiftDto {
            id: r.try_get("id").unwrap_or_default(),
            tenant_id: r.try_get("tenant_id").unwrap_or_default(),
            cashier_id: r.try_get("cashier_id").unwrap_or_default(),
            status: r.try_get("status").unwrap_or_default(),
            opened_at: r.try_get("opened_at").unwrap_or_default(),
            closed_at: None,
            expected_amount_cents: r.try_get("expected_amount_cents").unwrap_or(0),
            actual_amount_cents: None,
            difference_cents: None
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_open_shifts(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier])?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("
        SELECT s.id, s.cashier_id, u.name as cashier_name, s.opened_at, s.expected_amount_cents
        FROM shifts s LEFT JOIN users u ON s.cashier_id = u.id
        WHERE s.status = 'OPEN' ORDER BY s.opened_at ASC
    ").fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let shifts: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
        "id": r.try_get::<String,_>("id").unwrap_or_default(),
        "cashierId": r.try_get::<String,_>("cashier_id").unwrap_or_default(),
        "cashierName": r.try_get::<String,_>("cashier_name").unwrap_or_default(),
        "openedAt": r.try_get::<String,_>("opened_at").unwrap_or_default(),
        "openingBalance": r.try_get::<i32,_>("expected_amount_cents").unwrap_or(0),
    })).collect();
    Ok(shifts)
}

#[tauri::command]
pub async fn get_shift_history(
    cashier_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ShiftDto>, String> {
    // Neden yetki/tenant eklendi: komut parametresi olmadan tüm işletmelerin
    // vardiyalarını (kasa beklenen/gerçek tutarlarıyla) döküyordu.
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier],
    )?;
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let cid = cashier_id.unwrap_or_default();
    let rows = if cid.is_empty() || cid == "ALL" {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents
             FROM shifts WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT 50"
        )
        .bind(&tenant)
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents
             FROM shifts WHERE tenant_id = ? AND cashier_id = ? ORDER BY opened_at DESC LIMIT 50"
        )
        .bind(&tenant)
        .bind(&cid)
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    };

    let shifts = rows.into_iter().map(|r| ShiftDto {
        id: r.try_get("id").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
        cashier_id: r.try_get("cashier_id").unwrap_or_default(),
        status: r.try_get("status").unwrap_or_default(),
        opened_at: r.try_get("opened_at").unwrap_or_default(),
        closed_at: r.try_get("closed_at").ok().flatten(),
        expected_amount_cents: r.try_get("expected_amount_cents").unwrap_or(0),
        actual_amount_cents: r.try_get("actual_amount_cents").ok().flatten(),
        difference_cents: r.try_get("difference_cents").ok().flatten(),
    }).collect();
    Ok(shifts)
}
