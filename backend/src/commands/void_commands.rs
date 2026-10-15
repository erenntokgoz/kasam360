//! İptal (void) komutları ve onay yüzeyi
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

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
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Kiracı zorunlu ve boş olamaz: boş kiracı ile `tenant_id = ''`
    // sorgusu hiçbir satır eşleştirmez ve iptal sessizce
    // başarısız olur (AGENTS.md §3.3).
    let tenant_id = tenant_id.trim().to_string();
    if tenant_id.is_empty() {
        return Err("UNAUTHORIZED: tenant_id is required".to_string());
    }

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
    // Kiracı filtresi tek taraftır: `OR` ile varsayılan kiracı
    // eklemek, başka bir işletmenin siparişini iptal
    // edilebilir hâle getirirdi (AGENTS.md §3.3).
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

    // Jeton kapsamındaki tutar, istemciden değil veritabanındaki sipariş
    // satırından okunur: istemci kendi gönderdiği tutarla onay almış olamaz.
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

    // K1: iptal onay jetonu olmadan çalışmaz. MASTER/OWNER/MANAGER dahil her rol
    // için geçerlidir; self-approval ve eşik kuralları `consume_token`
    // içinde yeniden denetlenir.
    let approver = require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    sqlx::query(
        "UPDATE orders SET status = 'VOID', notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?), updated_at = datetime('now') WHERE ((id = ? AND status NOT IN ('PAID', 'CLOSED', 'VOID')) OR (table_id = ? AND status IN ('OPEN', 'IN_PROGRESS'))) AND tenant_id = ?"
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

    let remaining: i64 = count_row.try_get("count").map_err(|e| e.to_string())?;

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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &consumed_ctx)
        .await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}

/// Görsel / onay için iptal payload'ı: sadece `orderId` ve `reason` gerekir.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CompensationVoidPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    pub reason: String,
    /// Anlık PIN onayından gelen tek kullanımlık jeton. Compensation void,
    /// normal void_order'dan farklı olarak PAID / COMPENSATED siparişi de
    /// etkiler — bu yüzden onay zorunlu ve scope'u daraltılmıştır.
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

/// Compensation void: ödemiş/kapalı siparişi tersine çevirir.
///
/// P0 Güvenlik Kilidi #11: `void_order` PAID veya CLOSED siparişi kesinlikle
/// engeller. Bu komut onun yerini görür — ama sadece OWNER ya da MANAGER rolünde
/// ve geçerli onay token'ı ile çalışır. Üçlü koruma:
///   1. Rol (OWNER | MANAGER),
///   2. Sipariş durumu PAID / COMPENSATED olmalı,
///   3. Token scope'u `(operation=REFUND, resource=order_id, amount=order_total)`
///      kanonik olarak eşleşmelidir.
///
/// Ters kayıt iki yerde oluşur:
///   a) `refunds` tablosu — kalıcı ters hareket kaydı (amount_cents > 0).
///   b) `audit_ledger`   — zinciri kırar; `category::FINANS`, action `compensation:refund`.
///
/// AGENTS.md §3.4: `unwrap_or(0)` yoktur; `total_cents` `?` ile yükseltilir,
/// hata defterine geçer.
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

    // Compensation void yalnızca Owner ve Manager yapabilir. Cashier bile bırakamaz.
    match actor_role {
        Role::Owner | Role::Manager => {}
        Role::Cashier | Role::Waiter | Role::Kitchen | Role::Master => {
            return Err("UNAUTHORIZED: Bu rol compensation void yapamaz".to_string());
        }
    }

    // Siparişi ve tutarını oku (tenant filtresi ZORUNLU, §3.3).
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

    // Yalnızca PAID siparişler compensation void'e tabi tutulabilir.
    // OPEN / IN_PROGRESS → normal void_order ile iptal edilir.
    let upper = order_status.to_uppercase();
    if upper != "PAID" {
        return Err(format!(
            "INVALID_STATE: Compensation void yalnızca PAID sipariş için geçerlidir. Durum: {}",
            upper
        ));
    }

    if order_total_cents <= 0 {
        // AGENTS.md §3.4: 0 tutarı unwrap_or_default gibi sessiz geçilmez.
        // 0 tutar tesadüfen boş bir P&L gösterir; açıkça reddedilir.
        return Err("INVALID_AMOUNT: Compensation void tutarı 0'dan büyük olmalıdır.".to_string());
    }

    // Onay token'ı zorunlu. Scope: operation=REFUND, resource=order_id, amount=order_total.
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

    let approver = crate::commands::void_commands::require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    // Ters hareket id'si (txn_ prefix, §2).
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
    .bind(&payload.order_id)
    .bind(&payload.order_id)
    .bind(&refund_id)
    .bind(order_total_cents)
    .bind(&payload.reason)
    .bind(&approver.approver_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Siparişi COMPENSATED durumuna geçir — order_id tekrar kullanıma açılır ama
    // kaydı defterde kalır. tenant_id filtresi zorunludur (§3.3).
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

    // b) audit_ledger: ters kayıt. payload_json hash girdisidir, kanonik sırada.
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

    // Jeton tüketim kaydı
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
