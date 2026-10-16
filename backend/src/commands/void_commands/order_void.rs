//! Sipariş iptal (void) ve tazminat (compensation void) komutları.

use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::audit_service::category;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VoidOrderPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

/// İptalin onay yüzeyi. Kapsam `resource_id` + tutardır.
pub fn void_approval_request(
    tenant_id: &str,
    resource_id: &str,
    amount_cents: i64,
    actor_id: &str,
    actor_role: &str,
) -> crate::approval_service::ApprovalRequest {
    crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.to_string(),
        operation: crate::approval_service::operation::VOID.to_string(),
        resource_id: resource_id.to_string(),
        actor_id: actor_id.trim().to_string(),
        actor_role: actor_role.trim().to_string(),
        amount_cents,
        approved_percent_hint: 0,
        terminal_id: "terminal_void".to_string(),
    }
}

/// İptal için onay jetonunu zorunlu kılar ve tüketir.
pub async fn require_void_approval(
    conn: &mut sqlx::SqliteConnection,
    request: &crate::approval_service::ApprovalRequest,
    token: Option<&str>,
) -> Result<crate::approval_service::VerifiedApproval, String> {
    let token = token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| crate::approval_service::error::TOKEN_REQUIRED.to_string())?;

    crate::approval_service::consume_token(conn, token, request).await
}

#[tauri::command]
pub async fn void_order(
    payload: VoidOrderPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let _payment_lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = tenant_id.trim().to_string();
    if tenant_id.is_empty() {
        return Err("UNAUTHORIZED: tenant_id is required".to_string());
    }

    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        crate::rbac::Role::Owner
        | crate::rbac::Role::Manager
        | crate::rbac::Role::Cashier
        | crate::rbac::Role::Waiter => {}
        crate::rbac::Role::Master | crate::rbac::Role::Kitchen => {
            return Err("UNAUTHORIZED: Bu rol sipariş iptali yapamaz".into());
        }
    }

    let current_order =
        sqlx::query("SELECT status, total_cents FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(&payload.order_id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    if let Some(r) = &current_order {
        let st: String = r.try_get("status").unwrap_or_default();
        let upper_st = st.to_uppercase();
        if upper_st == "PAID" || upper_st == "CLOSED" {
            return Err(
                "CANNOT_VOID_PAID_ORDER: Ödenmiş veya kapatılmış siparişler iptal edilemez."
                    .to_string(),
            );
        }
    }

    let order_total_cents: i64 = match &current_order {
        Some(r) => r.try_get("total_cents").map_err(|e| e.to_string())?,
        None => 0,
    };

    let approval_request = void_approval_request(
        &tenant_id,
        &payload.order_id,
        order_total_cents,
        &payload.actor_id,
        actor_role.as_str(),
    );

    let approver = require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    // Yalnızca hedef siparişi VOID yap (OR table_id filtresi kaldırıldı)
    sqlx::query(
        "UPDATE orders \
         SET status = 'VOID', \
             notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?), \
             updated_at = datetime('now') \
         WHERE id = ? AND status NOT IN ('PAID', 'CLOSED', 'VOID') AND tenant_id = ?",
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.order_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Siparişin tüm kalemlerini CANCELLED olarak işaretle
    sqlx::query(
        "UPDATE order_items \
         SET status = 'CANCELLED' \
         WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'",
    )
    .bind(&payload.order_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Masadaki kalan açık sipariş sayısını ve toplam tutarını hesapla
    let remaining_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND tenant_id = ?"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let remaining_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND tenant_id = ?"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if remaining_count == 0 {
        let _ = crate::services::reservation_service::close_open_for_table(
            &mut tx,
            &tenant_id,
            &payload.table_id,
            &payload.actor_id,
            "VOID",
        )
        .await;

        sqlx::query(
            "UPDATE tables SET status = 'AVAILABLE', current_total = 0, waiter_id = NULL, opened_at = NULL WHERE id = ? AND tenant_id = ?"
        )
        .bind(&payload.table_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query("UPDATE tables SET current_total = ? WHERE id = ? AND tenant_id = ?")
            .bind(remaining_total)
            .bind(&payload.table_id)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::SIPARIS_MASA,
        "order:voided",
        payload.order_id.clone(),
        serde_json::json!({
            "orderId": payload.order_id,
            "tableId": payload.table_id,
            "reason": payload.reason,
            "amountCents": order_total_cents,
            "approverId": approver.approver_id,
            "approverRole": approver.approver_role.as_str(),
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
        payload.order_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::VOID,
            "amountCents": order_total_cents,
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
pub struct CompensationVoidPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    pub reason: String,
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

#[tauri::command]
pub async fn create_compensation_void(
    payload: CompensationVoidPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = tenant_id.trim().to_string();
    if tenant_id.is_empty() {
        return Err("UNAUTHORIZED: tenant_id is required".to_string());
    }

    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        Role::Owner | Role::Manager => {}
        Role::Cashier | Role::Waiter | Role::Kitchen | Role::Master => {
            return Err("UNAUTHORIZED: Bu rol compensation void yapamaz".to_string());
        }
    }

    let order_row =
        sqlx::query("SELECT total_cents, status FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(&payload.order_id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    let order_row = order_row.ok_or(format!(
        "NOT_FOUND: Sipariş '{}' bulunamadı.",
        payload.order_id
    ))?;
    let order_total_cents: i64 = order_row
        .try_get("total_cents")
        .map_err(|e| e.to_string())?;
    let order_status: String = order_row.try_get("status").map_err(|e| e.to_string())?;

    let upper = order_status.to_uppercase();
    if upper != "PAID" {
        return Err(format!(
            "INVALID_STATE: Compensation void yalnızca PAID sipariş için geçerlidir. Durum: {}",
            upper
        ));
    }

    if order_total_cents <= 0 {
        return Err("INVALID_AMOUNT: Compensation void tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let approval_request = crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.clone(),
        operation: crate::approval_service::operation::REFUND.to_string(),
        resource_id: payload.order_id.clone(),
        actor_id: payload.actor_id.clone(),
        actor_role: actor_role.as_str().to_string(),
        amount_cents: order_total_cents,
        approved_percent_hint: 0,
        terminal_id: crate::id_generator::generate_terminal_id(),
    };

    let approver = require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    let refund_id = crate::id_generator::generate_id("ref");
    let now_iso = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, datetime('now'))",
    )
    .bind(&refund_id)
    .bind(&tenant_id)
    .bind(&payload.order_id)
    .bind(&payload.order_id)
    .bind(&refund_id)
    .bind(order_total_cents)
    .bind(&payload.reason)
    .bind(&approver.approver_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE orders SET status = 'COMPENSATED', \
            notes = COALESCE(notes || ' | Compensation void: ' || ?, 'Compensation void: ' || ?), \
            updated_at = datetime('now') \
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.order_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let audit_payload = serde_json::json!({
        "orderId": payload.order_id,
        "amountCents": order_total_cents,
        "reason": payload.reason,
        "approverId": approver.approver_id,
        "approverRole": approver.approver_role.as_str(),
        "compensationTxnId": refund_id,
        "operation": crate::approval_service::operation::REFUND,
    });

    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::FINANS,
        "compensation:refund",
        payload.order_id.clone(),
        audit_payload,
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &audit_ctx).await?;

    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        category::GUVENLIK,
        "approval:consumed",
        payload.order_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::REFUND,
            "amountCents": order_total_cents,
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
