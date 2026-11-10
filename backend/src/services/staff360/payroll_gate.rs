//! Bordro para çıkışlarının işletme sahibi onay kapısı.
//!
//! Ekran erişimi ile mutasyon yetkisi ayrıdır: müdür bordro ekranını açabilir ve
//! tutarları görür (`require_payroll_amounts`), ama ücret kuralı değiştirmek, bordro
//! ya da personel hesabı ödemek ve avans vermek para kararıdır. İşletme sahibi bunları
//! doğrudan yapar; müdür yalnız işletme sahibinin PIN'iyle alınmış, işleme bağlı ve tek
//! kullanımlık bir onay jetonuyla yapar. Jeton yoksa, süresi dolmuşsa, başka işleme aitse
//! ya da onaylayan sahip değilse işlem reddedilir (fail-closed).

use sqlx::SqliteConnection;

use crate::approval_service::{self, operation, ApprovalRequest};
use crate::rbac::{self, Role};
use crate::services::audit_service::{self, AuditContext, AuditLock, AuditService};

/// Kapıdan geçen işlemin kimin onayıyla yapıldığı. `None` = sahip doğrudan yaptı.
#[derive(Debug, PartialEq, Eq)]
pub struct Authorized {
    pub approver_id: Option<String>,
}

/// Onay jetonunun bağlandığı kaynak. Onaylayan jetonu işlemden önce alır; bu yüzden
/// kaynak, işlemin sonradan üretilen kimliğine değil, önceden bilinen kimliklere bağlıdır.
pub fn resource(kind: &str, target: &str) -> String {
    format!("{kind}:{}", target.trim())
}

/// Para çıkışı yetkisini denetler. Sahip doğrudan geçer; müdür sahip onayı ister.
#[allow(clippy::too_many_arguments)]
pub async fn authorize_money_out(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    operation_name: &str,
    resource_id: &str,
    amount_cents: i64,
    token: Option<&str>,
) -> Result<Authorized, String> {
    if !matches!(
        operation_name,
        operation::PAYROLL_PAY | operation::PAYROLL_RULE | operation::STAFF_ADVANCE
    ) {
        return Err("INVALID_OPERATION: bordro kapısı bu işlemi tanımıyor".to_string());
    }
    match rbac::canonical_role(actor_role) {
        Some(Role::Owner) => return Ok(Authorized { approver_id: None }),
        Some(Role::Manager) => {}
        _ => {
            return Err("UNAUTHORIZED: Bu işlem için yetki yok (izin: OWNER, MANAGER).".to_string())
        }
    }
    let token = token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| approval_service::error::TOKEN_REQUIRED.to_string())?;
    let request = ApprovalRequest {
        tenant_id: tenant_id.to_string(),
        operation: operation_name.to_string(),
        resource_id: resource_id.to_string(),
        actor_id: actor_id.trim().to_string(),
        actor_role: actor_role.trim().to_string(),
        amount_cents,
        approved_percent_hint: 0,
        terminal_id: "terminal_payroll".to_string(),
    };
    let approver = approval_service::consume_token(conn, token, &request).await?;
    // Jetonu üreten yol sahibi zorunlu kılar; tüketimde yeniden denetlenir ki elle
    // yazılmış ya da eski bir onay satırı müdürün kendi onayıyla geçmesini sağlamasın.
    if approver.approver_role != Role::Owner {
        return Err(approval_service::error::APPROVER_NOT_ALLOWED.to_string());
    }
    let context = AuditContext::new(
        tenant_id.to_string(),
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        audit_service::category::GUVENLIK,
        "approval:consumed",
        resource_id.to_string(),
        serde_json::json!({
            "operation": operation_name,
            "amountCents": amount_cents,
            "actorId": request.actor_id,
            "approverId": approver.approver_id,
            "approverRole": approver.approver_role.as_str(),
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, audit_lock, &context).await?;
    Ok(Authorized {
        approver_id: Some(approver.approver_id),
    })
}
