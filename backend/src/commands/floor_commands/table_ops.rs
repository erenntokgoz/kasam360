//! Masa operasyon komutları: ekleme, silme, adlandırma, taşıma, birleştirme ve kalem aktarımı.

use crate::commands::command_helpers::{audit_actor, require_tenant_id, table_tenant};
use crate::db::DbPool;

#[tauri::command]
pub async fn add_table(
    id: String,
    name: String,
    tenant_id: String,
    zone: Option<String>,
    seats: Option<i64>,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let seats_val = seats.unwrap_or(4);
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total, zone, seats) \
         VALUES (?, ?, ?, 'AVAILABLE', 0, ?, ?)",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&name)
    .bind(&zone)
    .bind(seats_val)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "id": id,
        "name": name,
        "zone": zone,
        "seats": seats_val,
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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

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
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = table_tenant(&mut tx, &id).await?;

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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

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
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
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
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant = require_tenant_id(tenant_id.as_deref())?;

    crate::services::reservation_service::assert_no_open_reservation(&mut tx, &tenant, &from_id)
        .await?;
    crate::services::reservation_service::assert_no_open_reservation(&mut tx, &tenant, &to_id)
        .await?;

    // Hedef masa dolu ise taşıma yapılamaz; birleştirme (merge) gereklidir.
    let target_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM tables WHERE id = ? AND tenant_id = ?")
            .bind(&to_id)
            .bind(&tenant)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    if target_status.as_deref() == Some("OCCUPIED") {
        return Err("TARGET_OCCUPIED: Hedef masa dolu, lütfen merge_tables kullanın".to_string());
    }

    // Kaynak masanın garson ve açılış bilgilerini al
    let source_info: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT waiter_id, opened_at FROM tables WHERE id = ? AND tenant_id = ?")
            .bind(&from_id)
            .bind(&tenant)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    let (src_waiter, src_opened) = source_info.unwrap_or((None, None));

    // Siparişleri aktar
    sqlx::query(
        "UPDATE orders SET table_id = ? \
         WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(&to_id)
    .bind(&from_id)
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Hedef masayı aç, garson ve açılış bilgilerini taşı, yürüyen toplamı güncelle
    sqlx::query(
        "UPDATE tables \
         SET status = 'OCCUPIED', \
             waiter_id = COALESCE(?, waiter_id), \
             opened_at = COALESCE(?, opened_at, datetime('now')), \
             current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&src_waiter)
    .bind(&src_opened)
    .bind(&to_id)
    .bind(&tenant)
    .bind(&to_id)
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Kaynak masayı serbest bırak ve sıfırla
    sqlx::query(
        "UPDATE tables \
         SET status = 'AVAILABLE', current_total = 0, waiter_id = NULL, opened_at = NULL \
         WHERE id = ? AND tenant_id = ?",
    )
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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

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
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant = require_tenant_id(tenant_id.as_deref())?;

    crate::services::reservation_service::assert_no_open_reservation(&mut tx, &tenant, &source_id)
        .await?;
    crate::services::reservation_service::assert_no_open_reservation(&mut tx, &tenant, &target_id)
        .await?;

    // Kaynak masadan hedef masaya tüm açık siparişleri taşı
    sqlx::query(
        "UPDATE orders SET table_id = ? \
         WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(&target_id)
    .bind(&source_id)
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Kaynak masayı serbest bırak
    sqlx::query(
        "UPDATE tables \
         SET status = 'AVAILABLE', current_total = 0, waiter_id = NULL, opened_at = NULL \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&source_id)
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Hedef masayı OCCUPIED yap, açılış saatini koru veya şimdiye set et, yürüyen toplamı güncelle
    sqlx::query(
        "UPDATE tables \
         SET status = 'OCCUPIED', \
             opened_at = COALESCE(opened_at, datetime('now')), \
             current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&target_id)
    .bind(&tenant)
    .bind(&target_id)
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
