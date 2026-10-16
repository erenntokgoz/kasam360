//! İade ve tazminat komutları (create_compensation_refund).
//!
//! Neden ayrı dosya: payment_commands.rs dosyasının 500 satır tavanını
//! aşmasını önlemek için iade işlemleri bu modüle ayrıldı.

use super::types::CompensationRefundPayloadDto;
use crate::db::DbPool;
use crate::rbac::Role;

/// Compensation refund: yapılmış bir tahsilatı tersine çevirir.
///
/// `create_compensation_void` sipariş seviyesinde, bu komut transaction
/// seviyesindedir. Orijinal `transaction_id` (`txn_*`) üzerinden events tablosunda
/// kaydı bulunur; aynı tutarın tersini yazar.
///
/// Süreç:
///   1. Actor rolü yetkili mi? (OWNER | MANAGER)
///   2. Orijinal transaction var mı ve tutarı > 0 mı? (hata yükseltilir, 0'a dönülmez)
///   3. Onay tokenı tüketilir (scope: operation=REFUND, resource=original_txn_id).
///   4. `refunds` tablosuna ters kayıt eklenir.
///   5. `events` tablosuna COMPENSATION_REVERSAL event'i eklenir.
///   6. `audit_ledger`e FINANS kategorisinde `compensation:refund` kaydı eklenir.
///
/// AGENTS.md §2: ters ID `ref_` prefix'li ULID. §2.2: hata `?` ile yükseltilir.
#[tauri::command]
pub async fn create_compensation_refund(
    payload: CompensationRefundPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    use crate::services::audit_service::category;

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
        Role::Owner | Role::Manager => {}
        Role::Cashier | Role::Waiter | Role::Kitchen | Role::Master => {
            return Err("UNAUTHORIZED: Bu rol compensation refund yapamaz".to_string());
        }
    }

    if payload.amount_cents <= 0 {
        return Err("INVALID_AMOUNT: Refund tutarı 0'dan büyük olmalıdır.".to_string());
    }

    // Orijinal transaction'ı doğrula (tenant filtresiz arama kesinlikle YASAK).
    let original_event = sqlx::query(
        "SELECT aggregate_id, payload FROM events \
         WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = 'SALE' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&payload.original_transaction_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if original_event.is_none() {
        return Err(format!(
            "NOT_FOUND: Transaction '{}' bu kiracı için bulunamadı.",
            payload.original_transaction_id
        ));
    }

    // Onay tokenı
    let approval_request = crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.clone(),
        operation: crate::approval_service::operation::REFUND.to_string(),
        resource_id: payload.original_transaction_id.clone(),
        actor_id: payload.actor_id.clone(),
        actor_role: actor_role.as_str().to_string(),
        amount_cents: payload.amount_cents,
        approved_percent_hint: 0,
        terminal_id: crate::id_generator::generate_terminal_id(),
    };

    let approver = crate::commands::void_commands::require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    let refund_id = crate::id_generator::generate_id("ref");
    let now_iso = chrono::Utc::now().to_rfc3339();

    // a) refunds tablosu
    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, datetime('now'))",
    )
    .bind(&refund_id)
    .bind(&tenant_id)
    .bind(&payload.original_transaction_id)
    .bind(payload.order_id.as_deref().unwrap_or(""))
    .bind(&refund_id)
    .bind(payload.amount_cents)
    .bind(&payload.reason)
    .bind(&approver.approver_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // b) events: ters talep kaydı
    let comp_event_id = crate::id_generator::generate_id("evt");
    let comp_payload = serde_json::json!({
        "originalTransactionId": payload.original_transaction_id,
        "amountCents": payload.amount_cents,
        "reason": payload.reason,
        "compensationTxnId": refund_id,
    });
    let comp_payload_json = serde_json::to_string(&comp_payload).map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
         VALUES (?, ?, ?, 'COMPENSATION', 'REFUND_REVERSAL', ?, datetime('now'))"
    )
    .bind(&comp_event_id)
    .bind(&tenant_id)
    .bind(&payload.original_transaction_id)
    .bind(&comp_payload_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // c) audit_ledger
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::FINANS,
        "compensation:refund",
        payload.original_transaction_id.clone(),
        comp_payload,
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &audit_ctx).await?;

    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        category::GUVENLIK,
        "approval:consumed",
        payload.original_transaction_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::REFUND,
            "amountCents": payload.amount_cents,
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
