use serde::{Deserialize, Serialize};

use crate::db::DbPool;
use crate::services::audit_service::{self, AuditContext, AuditLock, AuditService};

/// Anlık PIN onayı isteği (Faz 3).
///
/// `pin` alanı yalnız bu çağrıda bulunur ve ne loglanır ne saklanır; doğrulama
/// sonucu tek kullanımlık `approvalToken` ile döner.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyManagerPinPayload {
    /// `VOID_ORDER` | `DISCOUNT` | `COMPLIMENTARY`
    pub operation: String,
    /// İşlemin bağlandığı kaynak (adisyon, sepet, fiş).
    pub resource_id: String,
    /// İşlemi yapan kişi. Self-approval kontrolü bu kimliğe karşı yapılır.
    pub actor_id: String,
    /// İşlemi yapan kişinin rolü; boş veya bilinmeyense fail-closed reddedilir.
    pub actor_role: String,
    /// İşlemin tutarı (kuruş).
    pub amount_cents: i64,
    /// İndirim yüzdesi (yalnız DISCOUNT için anlamlı).
    #[serde(default)]
    pub discount_percent: i64,
    /// Onay PIN'ini deneyen terminal; deneme sayacı bu kimlikle ayrılır.
    #[serde(default)]
    pub terminal_id: Option<String>,
    pub pin: String,
    /// Oturum tenant'ı. Oturum token'ı olmadığı için bu fazda çağıran
    /// tarafından gelir; onaylayan PIN yine de yalnız bu tenant içinde aranır.
    #[serde(default)]
    pub tenant_id: Option<String>,
}

/// Başarılı onay yanıtı. PIN veya hash **dönmez**; yalnız jeton ve onaylayan
/// kimliği (rapor için) döner.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalTokenDto {
    pub approved: bool,
    pub approval_token: String,
    pub approver_id: String,
    pub approver_name: String,
    pub approver_role: String,
    pub resource_id: String,
    pub operation: String,
    pub remaining_attempts: i64,
}

/// Anlık PIN onayını doğrular ve tek kullanımlık jeton üretir.
///
/// Salt okunur bir kimlik doğrulama komutudur: işlemin kendisini **yürütmez**,
/// hiçbir tabloyu değiştirmez. İşlemi yürüten komutlar jetonu kendileri tüketir.
#[tauri::command]
pub async fn verify_manager_pin(
    payload: VerifyManagerPinPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ApprovalTokenDto, String> {
    // İşlem yüzeyi kapalı listeden olmalı: kapsam kayması jetonla da yakalanır.
    let operation = payload.operation.trim().to_string();
    if !matches!(
        operation.as_str(),
        crate::approval_service::operation::VOID
            | crate::approval_service::operation::DISCOUNT
            | crate::approval_service::operation::COMPLIMENTARY
    ) {
        return Err("INVALID_OPERATION: Bilinmeyen onay işlemi.".to_string());
    }

    // İşlemi yapan kişinin rolü zorunludur; rol yoksa kapı fail-closed kalır.
    crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol.".to_string())?;

    let tenant_id = payload
        .tenant_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("DEFAULT_TENANT")
        .to_string();

    let request = crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.clone(),
        operation,
        resource_id: payload.resource_id.trim().to_string(),
        actor_id: payload.actor_id.trim().to_string(),
        actor_role: payload.actor_role.trim().to_string(),
        amount_cents: payload.amount_cents,
        approved_percent_hint: payload.discount_percent,
        terminal_id: payload
            .terminal_id
            .unwrap_or_else(|| "terminal_unknown".to_string()),
    };

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);

    let outcome = crate::approval_service::verify_and_issue(&mut conn, &request, &payload.pin).await;
    let remaining = crate::approval_service::remaining_attempts(&mut conn, &request)
        .await
        .unwrap_or(0);

    let verified = match outcome {
        Ok(verified) => verified,
        Err(err) => {
            // Kilit oluştuysa deftere yazılır: bu bir güvenlik olayıdır, gürültü
            // değildir. Tekil hatalı PIN denemeleri yazılmaz (defter şişer).
            if err.starts_with(crate::approval_service::error::LOCKED) {
                let ctx = AuditContext::new(
                    tenant_id.clone(),
                    request.terminal_id.clone(),
                    request.actor_role.clone(),
                    audit_service::category::GUVENLIK,
                    "approval:lockout",
                    request.resource_id.clone(),
                    serde_json::json!({ "operation": request.operation }),
                    chrono::Utc::now().to_rfc3339(),
                )?;
                AuditService::append(&mut conn, &audit_lock, &ctx).await?;
            }
            return Err(err);
        }
    };

    let ctx = AuditContext::new(
        tenant_id,
        verified.approver_id.clone(),
        verified.approver_role.as_str().to_string(),
        audit_service::category::GUVENLIK,
        "approval:verified",
        request.resource_id.clone(),
        serde_json::json!({
            "operation": request.operation,
            "amountCents": request.amount_cents,
            "approverName": verified.approver_name,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;

    Ok(ApprovalTokenDto {
        approved: true,
        approval_token: verified.token,
        approver_id: verified.approver_id,
        approver_name: verified.approver_name,
        approver_role: verified.approver_role.as_str().to_string(),
        resource_id: request.resource_id,
        operation: request.operation,
        remaining_attempts: remaining,
    })
}
