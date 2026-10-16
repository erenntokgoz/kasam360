//! Sipariş kalemi bazında iptal (void) ve ikram (comp) komutları.

use crate::commands::command_helpers::require_tenant_id;
use crate::commands::void_commands::order_void::{require_void_approval, void_approval_request};
use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::audit_service::category;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VoidOrderItemPayloadDto {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

#[tauri::command]
pub async fn void_order_item(
    payload: VoidOrderItemPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let _payment_lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = require_tenant_id(Some(&tenant_id))?;
    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        Role::Owner | Role::Manager | Role::Cashier | Role::Waiter => {}
        Role::Master | Role::Kitchen => {
            return Err("UNAUTHORIZED: Bu rol sipariş kalemi iptali yapamaz".into());
        }
    }

    let item_row = sqlx::query(
        "SELECT oi.id, oi.order_id, oi.total_cents, oi.status, oi.paid_quantity, \
                o.table_id, o.status as order_status \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id \
         WHERE oi.id = ? AND oi.tenant_id = ?",
    )
    .bind(&payload.item_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let row = item_row.ok_or_else(|| "ITEM_NOT_FOUND: Kalem bulunamadı.".to_string())?;
    let order_id: String = row.try_get("order_id").map_err(|e| e.to_string())?;
    let table_id: String = row.try_get("table_id").map_err(|e| e.to_string())?;
    let item_total_cents: i64 = row.try_get("total_cents").map_err(|e| e.to_string())?;
    let item_status: String = row.try_get("status").unwrap_or_default();
    let paid_quantity: i64 = row.try_get("paid_quantity").unwrap_or(0);
    let order_status: String = row.try_get("order_status").unwrap_or_default();

    if item_status == "CANCELLED" || item_status == "VOID" {
        return Err("ALREADY_CANCELLED: Bu kalem zaten iptal edilmiş.".into());
    }

    if paid_quantity > 0 {
        return Err(
            "CANNOT_VOID_PAID_ITEM: Kısmen veya tamamen ödenmiş kalem iptal edilemez.".into(),
        );
    }

    let upper_order_st = order_status.to_uppercase();
    if upper_order_st == "PAID" || upper_order_st == "CLOSED" {
        return Err("CANNOT_VOID_PAID_ORDER: Ödenmiş siparişin kalemi iptal edilemez.".into());
    }

    let approval_request = void_approval_request(
        &tenant_id,
        &payload.item_id,
        item_total_cents,
        &payload.actor_id,
        actor_role.as_str(),
    );

    let approver = require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    sqlx::query(
        "UPDATE order_items \
         SET status = 'CANCELLED', \
             notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.item_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Sipariş toplamını yeniden hesapla
    sqlx::query(
        "UPDATE orders \
         SET total_cents = (SELECT COALESCE(SUM(total_cents), 0) FROM order_items WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'), \
             updated_at = datetime('now') \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&order_id)
    .bind(&tenant_id)
    .bind(&order_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Masanın yürüyen toplamını güncelle
    sqlx::query(
        "UPDATE tables \
         SET current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&table_id)
    .bind(&tenant_id)
    .bind(&table_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::SIPARIS_MASA,
        "order_item:voided",
        payload.item_id.clone(),
        serde_json::json!({
            "itemId": payload.item_id,
            "orderId": order_id,
            "tableId": table_id,
            "reason": payload.reason,
            "amountCents": item_total_cents,
            "approverId": approver.approver_id,
        }),
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &audit_ctx).await?;

    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        category::GUVENLIK,
        "approval:consumed",
        payload.item_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::VOID,
            "amountCents": item_total_cents,
            "actorId": payload.actor_id,
            "approverId": approver.approver_id,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &consumed_ctx)
        .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CompOrderItemPayloadDto {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

#[tauri::command]
pub async fn comp_order_item(
    payload: CompOrderItemPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let _payment_lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = require_tenant_id(Some(&tenant_id))?;
    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        Role::Owner | Role::Manager => {}
        Role::Cashier | Role::Waiter | Role::Kitchen | Role::Master => {
            return Err("UNAUTHORIZED: Bu rol ikram işlemi yapamaz".into());
        }
    }

    let item_row = sqlx::query(
        "SELECT oi.id, oi.order_id, oi.total_cents, oi.status, oi.is_comp, \
                o.table_id, o.status as order_status \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id \
         WHERE oi.id = ? AND oi.tenant_id = ?",
    )
    .bind(&payload.item_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let row = item_row.ok_or_else(|| "ITEM_NOT_FOUND: Kalem bulunamadı.".to_string())?;
    let order_id: String = row.try_get("order_id").map_err(|e| e.to_string())?;
    let table_id: String = row.try_get("table_id").map_err(|e| e.to_string())?;
    let item_total_cents: i64 = row.try_get("total_cents").map_err(|e| e.to_string())?;
    let item_status: String = row.try_get("status").unwrap_or_default();
    let is_comp: i64 = row.try_get("is_comp").unwrap_or(0);
    let order_status: String = row.try_get("order_status").unwrap_or_default();

    if item_status == "CANCELLED" || item_status == "VOID" {
        return Err("ALREADY_CANCELLED: İptal edilmiş kalem ikram edilemez.".into());
    }

    if is_comp != 0 {
        return Err("ALREADY_COMPED: Bu kalem zaten ikram edilmiş.".into());
    }

    let upper_order_st = order_status.to_uppercase();
    if upper_order_st == "PAID" || upper_order_st == "CLOSED" {
        return Err("CANNOT_COMP_PAID_ORDER: Ödenmiş siparişin kalemi ikram edilemez.".into());
    }

    let approval_request = crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.clone(),
        operation: crate::approval_service::operation::DISCOUNT.to_string(),
        resource_id: payload.item_id.clone(),
        actor_id: payload.actor_id.clone(),
        actor_role: actor_role.as_str().to_string(),
        amount_cents: item_total_cents,
        approved_percent_hint: 100,
        terminal_id: "terminal_comp".to_string(),
    };

    let approver = require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    sqlx::query(
        "UPDATE order_items \
         SET is_comp = 1, unit_price_cents = 0, subtotal_cents = 0, tax_amount_cents = 0, total_cents = 0, \
             notes = COALESCE(notes || ' | İkram: ' || ?, 'İkram: ' || ?) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.item_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Sipariş toplamını yeniden hesapla
    sqlx::query(
        "UPDATE orders \
         SET total_cents = (SELECT COALESCE(SUM(total_cents), 0) FROM order_items WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'), \
             updated_at = datetime('now') \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&order_id)
    .bind(&tenant_id)
    .bind(&order_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Masanın yürüyen toplamını güncelle
    sqlx::query(
        "UPDATE tables \
         SET current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')) \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&table_id)
    .bind(&tenant_id)
    .bind(&table_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::FINANS,
        "order_item:comped",
        payload.item_id.clone(),
        serde_json::json!({
            "itemId": payload.item_id,
            "orderId": order_id,
            "tableId": table_id,
            "reason": payload.reason,
            "originalAmountCents": item_total_cents,
            "approverId": approver.approver_id,
        }),
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &audit_ctx).await?;

    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        category::GUVENLIK,
        "approval:consumed",
        payload.item_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::DISCOUNT,
            "amountCents": item_total_cents,
            "actorId": payload.actor_id,
            "approverId": approver.approver_id,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &consumed_ctx)
        .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(true)
}
