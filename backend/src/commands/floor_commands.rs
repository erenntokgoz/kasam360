//! Salon ve masa komutları (plan, taşıma, ekleme, silme, kilit)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use crate::commands::command_helpers::{audit_actor, require_tenant_id, table_tenant};


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FloorPlanData {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(rename = "openedAt")]
    pub opened_at: Option<String>,
    #[serde(rename = "waiterId")]
    pub waiter_id: Option<String>,
    /// Running total for the table in integer cents. 0 means no active order.
    #[serde(rename = "currentTotal")]
    pub current_total: i64,
}

#[tauri::command]
pub async fn get_floor_plan(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<FloorPlanData>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, status, opened_at, waiter_id, current_total FROM tables WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        res.push(FloorPlanData {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            status: row.try_get("status").unwrap_or_else(|_| "AVAILABLE".to_string()),
            opened_at: row.try_get("opened_at").ok(),
            waiter_id: row.try_get("waiter_id").ok(),
            current_total: row.try_get::<i64, _>("current_total").unwrap_or(0),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn move_table(
    from_id: String,
    to_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Tenant çözümlemesi: masa taşıma kiracı sınırını aşamaz. Bu komut Faz 8
    // öncesi `WHERE id=?` filtresiyle çalışıyordu; başka bir işletmenin masası
    // taşınabiliyor ve o işletmenin rezervasyonu sessizce eziliyordu.
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    // Açık rezervasyonlu masalar taşınamaz: taşıma kaynak masayı `AVAILABLE`
    // yapıyor, rezervasyon kaydı ortada kalınca hedef masaya hayalet blok
    // bindirilirdi. Önce rezervasyon kaldırılmalıdır.
    crate::services::reservation_service::assert_no_open_reservation(
        &mut tx, &tenant, &from_id,
    )
    .await?;
    crate::services::reservation_service::assert_no_open_reservation(
        &mut tx, &tenant, &to_id,
    )
    .await?;

    sqlx::query("UPDATE tables SET status='AVAILABLE' WHERE id=? AND tenant_id=?")
        .bind(&from_id)
        .bind(&tenant)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET status='OCCUPIED' WHERE id=? AND tenant_id=?")
        .bind(&to_id)
        .bind(&tenant)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE orders SET table_id=? WHERE table_id=? AND tenant_id=? AND status IN ('OPEN', 'IN_PROGRESS')")
        .bind(&to_id)
        .bind(&from_id)
        .bind(&tenant)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "fromId": from_id,
        "toId": to_id
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant.clone(),
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:move",
        to_id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn add_table(
    id: String,
    name: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES (?, ?, ?, 'AVAILABLE', 0)")
        .bind(&id)
        .bind(&tenant_id)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "id": id,
        "name": name
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:add",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_table(
    id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = table_tenant(&mut tx, &id).await;

    sqlx::query("DELETE FROM tables WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "id": id
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:remove",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Masa adı değişikliği "Eski Değer → Yeni Değer" sütununu besleyen ilk
/// kayıttır: değişiklik `changes` nesnesiyle payload'a yazılır.
#[tauri::command]
pub async fn update_table_name(
    id: String,
    name: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let previous_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM tables WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET name = ? WHERE id = ? AND tenant_id = ?")
        .bind(&name)
        .bind(&id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "tableId": id,
        "changes": {
            "name": { "old": previous_name, "new": name }
        }
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:renamed",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn merge_tables(
    source_id: String,
    target_id: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant = require_tenant_id(tenant_id.as_deref())?;

    // Birleştirme açık rezervasyonlu masayı da boşaltıyordu; rezervasyon kaydı
    // ortada kalınca hedef masaya hayalet blok bindiriliyordu. Kapı: iki masada da
    // açık rezervasyon olmamalıdır.
    crate::services::reservation_service::assert_no_open_reservation(
        &mut tx, &tenant, &source_id,
    )
    .await?;
    crate::services::reservation_service::assert_no_open_reservation(
        &mut tx, &tenant, &target_id,
    )
    .await?;

    // Move all open orders from source to target
    sqlx::query("UPDATE orders SET table_id = ? WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
        .bind(&target_id).bind(&source_id).bind(&tenant)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    // Move all order_items if needed (they reference order_id, so no change needed)

    // Free the source table
    sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0, waiter_id = NULL, opened_at = NULL WHERE id = ? AND tenant_id = ?")
        .bind(&source_id).bind(&tenant)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    // Recalculate target table total
    sqlx::query("UPDATE tables SET current_total = (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE table_id = ? AND status IN ('OPEN','IN_PROGRESS')) WHERE id = ? AND tenant_id = ?")
        .bind(&target_id).bind(&target_id).bind(&tenant)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let payload = serde_json::json!({"sourceId": source_id, "targetId": target_id});
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:merged",
        target_id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn try_lock_table(
    table_id: String,
    waiter_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let mut locks = state.table_locks.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    
    if let Some((locked_by, locked_at)) = locks.get(&table_id) {
        if locked_by != &waiter_id && (now - locked_at) < 1800000 {
            return Ok(false);
        }
    }
    
    locks.insert(table_id, (waiter_id, now));
    Ok(true)
}

#[tauri::command]
pub async fn unlock_table(
    table_id: String,
    waiter_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut locks = state.table_locks.lock().await;
    if let Some((locked_by, _)) = locks.get(&table_id) {
        if locked_by == &waiter_id {
            locks.remove(&table_id);
        }
    }
    Ok(())
}
