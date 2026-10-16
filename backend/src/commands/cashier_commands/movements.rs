//! Kasa nakit giriş, çıkış ve hareket listeleme komutları.
//!
//! Neden bu modül: nakit hareketleri doğrudan kasa çekmecesini
//! etkileyen finansal olaylardır; yetki ve onay kontrolleri
//! tek bir modülde toplanmıştır.

use super::dto::CashMovementDto;
use crate::db::DbPool;
use sqlx::Row;
use uuid::Uuid;

/// Kasa hareketi yazan roller.
pub const CASH_MOVEMENT_ROLES: [crate::rbac::Role; 2] =
    [crate::rbac::Role::Owner, crate::rbac::Role::Cashier];

/// Kasa hareketi kapısını fail-closed geçirir.
pub(crate) fn cash_hareket_kapisi(actor_role: Option<&str>) -> Result<crate::rbac::Role, String> {
    crate::rbac::require_any_present(actor_role, &CASH_MOVEMENT_ROLES)
}

#[tauri::command]
pub async fn get_cash_movements(
    shift_id: String,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CashMovementDto>, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT id, shift_id, movement_type, amount_cents, reason, actor_id, created_at 
         FROM cash_movements 
         WHERE shift_id = ? AND tenant_id = ? 
         ORDER BY created_at ASC",
    )
    .bind(&shift_id)
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(CashMovementDto {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            shift_id: r.try_get("shift_id").map_err(|e| e.to_string())?,
            movement_type: r.try_get("movement_type").map_err(|e| e.to_string())?,
            amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
            reason: r.try_get("reason").map_err(|e| e.to_string())?,
            actor_id: r.try_get("actor_id").map_err(|e| e.to_string())?,
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        });
    }

    Ok(list)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cash_in(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CashMovementDto, String> {
    use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

    let role = cash_hareket_kapisi(actor_role.as_deref())?;
    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let id = format!("cmin_{}", Uuid::new_v4());

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, 'IN', ?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let ctx = AuditContext::new(
        tenant_id,
        actor_id.clone(),
        role.as_str().to_string(),
        category::FINANS,
        "cash:movement_in",
        id.clone(),
        serde_json::json!({
            "shiftId": shift_id,
            "amountCents": amount_cents,
            "reason": reason,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "IN".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cash_out(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    session_token: Option<String>,
    #[allow(non_snake_case)] sessionToken: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CashMovementDto, String> {
    use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let session_token = session_token.or(sessionToken);

    let id = format!("cmout_{}", Uuid::new_v4());
    let bildirilen_rol = actor_role
        .as_deref()
        .map(str::trim)
        .filter(|deger| !deger.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: caller_role is required".to_string())?;
    let jeton = approval_token.or(approvalToken);

    let (actor_id, actor_role) = crate::services::security360::session::oturum_aktoru(
        &mut tx,
        session_token.as_deref(),
        &tenant_id,
        &actor_id,
        bildirilen_rol,
    )
    .await?;

    crate::rbac::require_any(&actor_role, &CASH_MOVEMENT_ROLES)?;

    use crate::services::security360::money_gate as gate;
    gate::nakit_tutar_gecerli_mi(amount_cents)?;
    gate::gerekce_gecerli_mi(&reason)?;

    let vardiya = sqlx::query("SELECT id, status FROM shifts WHERE id = ? AND tenant_id = ?")
        .bind(&shift_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let durum: Option<String> = match &vardiya {
        Some(satir) => Some(satir.try_get("status").map_err(|e| e.to_string())?),
        None => None,
    };
    gate::vardiya_kabul_eder_mi(durum.as_deref())?;

    let esik = crate::services::security360::threshold::esik_oku(&mut tx, &tenant_id).await?;
    if gate::onay_gerekli_mi(amount_cents, esik) {
        let token = gate::onay_jetonunu_zorunlu_kil(jeton.as_deref())?;
        let kaynak = gate::kasa_cikis_kaynagi(&shift_id, amount_cents);

        let request = crate::approval_service::ApprovalRequest {
            tenant_id: tenant_id.clone(),
            operation: crate::approval_service::operation::CASH_OUT.to_string(),
            resource_id: kaynak,
            actor_id: actor_id.trim().to_string(),
            actor_role: actor_role.clone(),
            amount_cents,
            approved_percent_hint: 0,
            terminal_id: "terminal_cash".to_string(),
        };
        let approver = crate::approval_service::consume_token(&mut tx, token, &request).await?;

        let ctx = AuditContext::new(
            tenant_id.clone(),
            approver.approver_id.clone(),
            approver.approver_role.as_str().to_string(),
            category::GUVENLIK,
            "approval:consumed",
            id.clone(),
            serde_json::json!({
                "operation": crate::approval_service::operation::CASH_OUT,
                "amountCents": amount_cents,
                "thresholdCents": esik,
                "actorId": request.actor_id,
                "approverId": approver.approver_id,
                "approverRole": approver.approver_role.as_str(),
            }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    }

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, 'OUT', ?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let ctx = AuditContext::new(
        tenant_id,
        actor_id.clone(),
        actor_role,
        category::FINANS,
        "cash:movement_out",
        id.clone(),
        serde_json::json!({
            "shiftId": shift_id,
            "amountCents": amount_cents,
            "reason": reason,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "OUT".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
