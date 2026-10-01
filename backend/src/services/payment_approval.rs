//! İndirim ve ikram için anlık PIN onayı kapısı.
//!
//! Neden ayrı bir dosya: onay kuralı hem `process_payment` hem
//! `process_split_payment` yolunda aynıdır. Kural iki komuta kopyalanırsa
//! biri unutulur ve indirim onaysız geçebilir; burada tek uygulama vardır.
//!
//! K2: **her** tutarda indirim onay ister; %20 veya 500 TL üzerindeki indirimde
//! onaylayan yalnız işletme sahibi veya müdür olabilir. %100 indirim (ikram)
//! daima yüksek eşiktedir, bu yüzden kasa ikram onaylayamaz.

use crate::approval_service::{self, operation, ApprovalRequest};
use crate::rbac;
use crate::repositories::payment_repository::ServerTruth;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use sqlx::SqliteConnection;

/// Onayın tüketildiği ve kim tarafından onaylandığı bilgisi.
#[derive(Debug, Clone)]
pub struct ConsumedApproval {
    pub approver_id: String,
    pub approver_role: String,
    pub operation: String,
    pub amount_cents: i64,
}

/// İndirim yüzeyinin türü. Yüzey, istemciden gelen bir bayrakla değil
/// **sunucu hesabından** belirlenir: %100 indirim ikramdır.
fn resolve_operation(server_truth: &ServerTruth) -> &'static str {
    if server_truth.gross_cents > 0 && server_truth.total_cents == 0 {
        operation::COMPLIMENTARY
    } else {
        operation::DISCOUNT
    }
}

/// İndirimin brüt tutara göre yüzdesi (kuruş üzerinden, yuvarlanmış).
///
/// K2 eşiğinin oran kolu buradan gelir; istemciden gelen yüzdeye güvenilmez.
fn discount_percent(server_truth: &ServerTruth) -> i64 {
    if server_truth.gross_cents <= 0 || server_truth.discount_cents <= 0 {
        return 0;
    }
    ((server_truth.discount_cents as f64 / server_truth.gross_cents as f64) * 100.0).round() as i64
}

/// Sunucu hesabındaki indirim için anlık PIN onayı jetonunu tüketir.
///
/// `server_truth.discount_cents` sıfırsa hiçbir yüzey açılmaz ve `Ok(None)`
/// döner; indirim yoksa onay da yoktur. Sıfırdan büyükse jeton **zorunludur**:
/// eksik jeton işlemi durdurur (fail-closed), yanlış jeton ayrım gözetimi,
/// eşik ve kapsam denetimlerinden geçemez.
pub async fn consume_discount_approval(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    resource_id: &str,
    server_truth: &ServerTruth,
    approval_token: Option<&str>,
) -> Result<Option<ConsumedApproval>, String> {
    if server_truth.discount_cents <= 0 {
        return Ok(None);
    }

    let operation = resolve_operation(server_truth);
    let request = ApprovalRequest {
        tenant_id: tenant_id.to_string(),
        operation: operation.to_string(),
        resource_id: resource_id.to_string(),
        actor_id: actor_id.trim().to_string(),
        actor_role: actor_role.trim().to_string(),
        amount_cents: server_truth.discount_cents,
        approved_percent_hint: discount_percent(server_truth),
        terminal_id: "terminal_payment".to_string(),
    };

    let token = approval_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| approval_service::error::TOKEN_REQUIRED.to_string())?;

    let approver = approval_service::consume_token(conn, token, &request).await?;
    let approver_role = approver.approver_role.as_str().to_string();

    // Jeton tüketimi ayrı bir güvenlik kaydı olarak yazılır; ödeme kaydının
    // içine gömülmesi tek satırda kalırsa "onay verildi" ve "onay kullanıldı"
    // ayrımı kaybolur.
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        approver.approver_id.clone(),
        approver_role.clone(),
        category::GUVENLIK,
        "approval:consumed",
        resource_id.to_string(),
        serde_json::json!({
            "operation": operation,
            "discountCents": server_truth.discount_cents,
            "discountPercent": request.approved_percent_hint,
            "actorId": request.actor_id,
            "approverId": approver.approver_id,
            "approverRole": approver_role,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, audit_lock, &ctx).await?;

    Ok(Some(ConsumedApproval {
        approver_id: approver.approver_id,
        approver_role,
        operation: operation.to_string(),
        amount_cents: server_truth.discount_cents,
    }))
}

/// Onay isteğinin taşıması gereken işlem yüzeyi. Jeton bu yüzeyle üretilir;
/// tüketimde aynı yüzey eşleşmezse kapsam hatası verilir.
pub fn operation_for_truth(server_truth: &ServerTruth) -> &'static str {
    resolve_operation(server_truth)
}

/// Testlerin de aynı kuralı görmesi için dışa açılan sarmalayıcı.
#[cfg(test)]
pub fn discount_percent_for_test(server_truth: &ServerTruth) -> i64 {
    discount_percent(server_truth)
}

/// Onaylayan rolün bu indirim için yetkili olup olmadığını doğrudan denetler.
///
/// Tüketim yolunda `consume_token` aynı denetimi kendi satırından yapar; bu
/// yardımcı, onay **üretilmeden** önce "bu indirim kim tarafından onaylanabilir"
/// sorusunun tek cevabını sunmak içindir (arayüz ve testler aynı kuralı görür).
pub fn approver_roles_for(operation: &str, percent_hint: i64, amount_cents: i64) -> Vec<rbac::Role> {
    let request = ApprovalRequest {
        tenant_id: String::new(),
        operation: operation.to_string(),
        resource_id: String::new(),
        actor_id: String::new(),
        actor_role: String::new(),
        amount_cents,
        approved_percent_hint: percent_hint,
        terminal_id: String::new(),
    };

    if approval_service::requires_privileged_approver(&request) {
        vec![rbac::Role::Owner, rbac::Role::Manager]
    } else {
        rbac::APPROVER_ROLES.to_vec()
    }
}

#[cfg(test)]
#[path = "payment_approval_tests.rs"]
mod tests;
