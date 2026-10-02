//! İptal (void) komutları ve onay yüzeyi
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
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
    /// Anlık PIN onayından gelen tek kullanımlık jeton. `managerPin` kaldırıldı:
    /// düz PIN artık hiçbir komuta taşınmaz, yalnız `verify_manager_pin` içinde
    /// Argon2 ile doğrulanır.
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

/// İptalin onay yüzeyi. Kapsam `order_id` + sipariş tutarıdır: jeton başka bir
/// adisyona veya başka bir tutara taşınamaz.
pub(crate) fn void_approval_request(
    tenant_id: &str,
    order_id: &str,
    amount_cents: i64,
    actor_id: &str,
    actor_role: &str,
) -> crate::approval_service::ApprovalRequest {
    crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.to_string(),
        operation: crate::approval_service::operation::VOID.to_string(),
        resource_id: order_id.to_string(),
        actor_id: actor_id.trim().to_string(),
        actor_role: actor_role.trim().to_string(),
        amount_cents,
        approved_percent_hint: 0,
        terminal_id: "terminal_void".to_string(),
    }
}

/// İptal için onay jetonunu zorunlu kılar ve tüketir.
///
/// Ayrı bir fonksiyon olarak yazıldı çünkü "jeton zorunlu" kuralı komutun
/// içine gömülünce test edilemez; bu yüzden kural burada tek yerde durur ve
/// hem `void_order` hem testler aynı kapıdan geçer.
pub(crate) async fn require_void_approval(
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
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Yetki (SPEC §34 "Void Onaylama"): kapı yasaklı rolleri sayan değil, yetkili
    // rolleri kabul eden bir eşleşmedir. MASTER ve mutfak sipariş iptali
    // yapamaz; geri kalan roller **onay jetonu olmadan** iptal edemez.
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

    // Ödenmiş veya kapatılmış siparişlerin iptal edilmesini kesinlikle engelle (P0 Güvenlik Kilidi)
    let current_order = sqlx::query("SELECT status, total_cents FROM orders WHERE id = ? AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
        .bind(&payload.order_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = &current_order {
        let st: String = r.try_get("status").unwrap_or_default();
        let upper_st = st.to_uppercase();
        if upper_st == "PAID" || upper_st == "CLOSED" {
            return Err("CANNOT_VOID_PAID_ORDER: Ödenmiş veya kapatılmış siparişler iptal edilemez.".to_string());
        }
    }

    // Jeton kapsamındaki tutar, istemciden değil veritabanındaki sipariş
    // satırından okunur: istemci kendi gönderdiği tutarla onay almış olamaz.
    let order_total_cents: i64 = current_order
        .as_ref()
        .and_then(|r| r.try_get::<i64, _>("total_cents").ok())
        .unwrap_or(0);

    let approval_request = void_approval_request(
        &tenant_id,
        &payload.order_id,
        order_total_cents,
        &payload.actor_id,
        actor_role.as_str(),
    );

    // K1: iptal onay jetonu olmadan çalışmaz. MASTER/OWNER/MANAGER dahil her rol
    // için geçerlidir; self-approval ve eşik kuralları `consume_token`
    // içinde yeniden denetlenir.
    let approver = require_void_approval(&mut tx, &approval_request, payload.approval_token.as_deref()).await?;

    sqlx::query(
        "UPDATE orders SET status = 'VOID', notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?), updated_at = datetime('now') WHERE ((id = ? AND status NOT IN ('PAID', 'CLOSED', 'VOID')) OR (table_id = ? AND status IN ('OPEN', 'IN_PROGRESS'))) AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')"
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.order_id)
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let count_row = sqlx::query(
        "SELECT COUNT(*) as count FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND tenant_id = ?"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let remaining: i64 = count_row.try_get("count").unwrap_or(0);

    if remaining == 0 {
        // Faz 8: iptal masayı boşaltıyorsa açık rezervasyon kaydı da kapanır.
        let _ = crate::services::reservation_service::close_open_for_table(
            &mut tx,
            &tenant_id,
            &payload.table_id,
            "VOID",
            "SIPARIS_IPTAL",
        )
        .await?;

        sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0 WHERE id = ? AND tenant_id = ?")
            .bind(&payload.table_id)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let payload_val = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "reason": payload.reason,
        "orderTotalCents": order_total_cents,
        "approverId": approver.approver_id,
        "approverRole": approver.approver_role.as_str(),
    });

    // İptal denetimde "Güvenlik" kategorisindedir: para hareketini tersine çevirir
    // ve yetkisi rol tarafından doğrulanmıştır. Rol burada sabit "Cashier"
    // yazılmaz; gerçek, kanonik rol kaydedilir.
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "order:voided",
        payload.order_id.clone(),
        payload_val,
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    // Jetonun tüketildiğinin izi ayrı bir güvenlik kaydı olarak yazılır: denetim
    // defterinde "onay verildi" ve "onay kullanıldı" ayrı ayrı görünür.
    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "approval:consumed",
        payload.order_id.clone(),
        serde_json::json!({
            "operation": crate::approval_service::operation::VOID,
            "amountCents": order_total_cents,
            "actorId": payload.actor_id,
            "approverId": approver.approver_id,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &consumed_ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}
