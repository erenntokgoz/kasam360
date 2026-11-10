//! Kasa nakit giriş, çıkış ve hareket listeleme komutları.
//!
//! Neden bu modül: nakit hareketleri doğrudan kasa çekmecesini
//! etkileyen finansal olaylardır; yetki ve onay kontrolleri
//! tek bir modülde toplanmıştır.

use super::dto::CashMovementDto;
use crate::db::DbPool;
use crate::services::lan_sync::WritePool;
use sqlx::Row;

/// Kasa hareketi yazan roller.
pub const CASH_MOVEMENT_ROLES: [crate::rbac::Role; 2] =
    [crate::rbac::Role::Owner, crate::rbac::Role::Cashier];

/// Kasa hareketi kapısını fail-closed geçirir.
pub(crate) fn cash_hareket_kapisi(actor_role: Option<&str>) -> Result<crate::rbac::Role, String> {
    crate::rbac::require_any_present(actor_role, &CASH_MOVEMENT_ROLES)
}

fn cash_in_fields_gate(amount_cents: i64, reason: &str) -> Result<(), String> {
    crate::services::security360::money_gate::nakit_tutar_gecerli_mi(amount_cents)?;
    crate::services::security360::money_gate::gerekce_gecerli_mi(reason)
}

fn cash_in_gate(amount_cents: i64, reason: &str, shift_status: Option<&str>) -> Result<(), String> {
    cash_in_fields_gate(amount_cents, reason)?;
    crate::services::security360::money_gate::vardiya_kabul_eder_mi(shift_status)
}

fn movement_id_is_valid(id: &str, prefix: &str) -> bool {
    id.strip_prefix(&format!("{prefix}_"))
        .is_some_and(|suffix| {
            suffix.len() == 24 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

async fn find_replayed_movement(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    tenant_id: &str,
    shift_id: &str,
    movement_type: &str,
    amount_cents: i64,
    reason: &str,
    actor_id: &str,
) -> Result<Option<CashMovementDto>, String> {
    let row = sqlx::query(
        "SELECT shift_id, movement_type, amount_cents, reason, actor_id, created_at
         FROM cash_movements WHERE id = ? AND tenant_id = ?",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| error.to_string())?;
    let Some(row) = row else { return Ok(None) };

    let stored_shift: String = row.try_get("shift_id").map_err(|error| error.to_string())?;
    let stored_type: String = row
        .try_get("movement_type")
        .map_err(|error| error.to_string())?;
    let stored_amount: i64 = row
        .try_get("amount_cents")
        .map_err(|error| error.to_string())?;
    let stored_reason: String = row.try_get("reason").map_err(|error| error.to_string())?;
    let stored_actor: String = row.try_get("actor_id").map_err(|error| error.to_string())?;
    if stored_shift != shift_id
        || stored_type != movement_type
        || stored_amount != amount_cents
        || stored_reason != reason
        || stored_actor != actor_id
    {
        return Err(
            "IDEMPOTENCY_CONFLICT: kasa hareketi kimliği farklı içerikle kullanıldı.".to_string(),
        );
    }

    Ok(Some(CashMovementDto {
        id: id.to_string(),
        shift_id: stored_shift,
        movement_type: stored_type,
        amount_cents: stored_amount,
        reason: stored_reason,
        actor_id: stored_actor,
        created_at: row
            .try_get("created_at")
            .map_err(|error| error.to_string())?,
    }))
}

pub(crate) async fn find_approved_cash_out_replay(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    tenant_id: &str,
    shift_id: &str,
    amount_cents: i64,
    reason: &str,
    actor_id: &str,
    actor_role: &str,
) -> Result<Option<CashMovementDto>, String> {
    let movement = find_replayed_movement(
        conn,
        id,
        tenant_id,
        shift_id,
        "OUT",
        amount_cents,
        reason,
        actor_id,
    )
    .await?;
    let Some(movement) = movement else {
        return Ok(None);
    };

    if crate::rbac::canonical_role(actor_role) == Some(crate::rbac::Role::Manager) {
        let approval_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_ledger
             WHERE tenant_id = ? AND action = 'approval:consumed' AND resource_id = ?
               AND json_extract(payload, '$.operation') = ?
               AND json_extract(payload, '$.actorId') = ?
               AND json_extract(payload, '$.approverRole') = 'OWNER'
               AND json_extract(payload, '$.amountCents') = ?",
        )
        .bind(tenant_id)
        .bind(id)
        .bind(crate::approval_service::operation::CASH_OUT)
        .bind(actor_id)
        .bind(amount_cents)
        .fetch_one(&mut *conn)
        .await
        .map_err(|error| error.to_string())?;
        if approval_count == 0 {
            return Err(crate::approval_service::error::TOKEN_REQUIRED.to_string());
        }
    }

    Ok(Some(movement))
}

pub(crate) async fn persist_movement(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    tenant_id: &str,
    shift_id: &str,
    movement_type: &str,
    amount_cents: i64,
    reason: &str,
    actor_id: &str,
    actor_role: &str,
    audit_action: &'static str,
    audit_lock: &crate::services::audit_service::AuditLock<'_>,
) -> Result<(CashMovementDto, bool), String> {
    if let Some(existing) = find_replayed_movement(
        conn,
        id,
        tenant_id,
        shift_id,
        movement_type,
        amount_cents,
        reason,
        actor_id,
    )
    .await?
    {
        return Ok((existing, false));
    }
    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(shift_id)
    .bind(movement_type)
    .bind(amount_cents)
    .bind(reason)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|error| error.to_string())?;

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        crate::services::audit_service::category::FINANS,
        audit_action,
        id.to_string(),
        serde_json::json!({ "shiftId": shift_id, "amountCents": amount_cents, "reason": reason }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(conn, audit_lock, &ctx).await?;

    let created_at: String =
        sqlx::query_scalar("SELECT created_at FROM cash_movements WHERE id = ? AND tenant_id = ?")
            .bind(id)
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|error| error.to_string())?;
    Ok((
        CashMovementDto {
            id: id.to_string(),
            shift_id: shift_id.to_string(),
            movement_type: movement_type.to_string(),
            amount_cents,
            reason: reason.to_string(),
            actor_id: actor_id.to_string(),
            created_at,
        },
        true,
    ))
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
    movement_id: Option<String>,
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CashMovementDto, String> {
    state.lan_sync.require_local_write()?;
    use crate::services::audit_service::AuditLock;

    let role = cash_hareket_kapisi(actor_role.as_deref())?;
    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;
    let movement_id = movement_id.unwrap_or_else(|| crate::id_generator::generate_id("cmin"));
    if !movement_id_is_valid(&movement_id, "cmin") {
        return Err("VALIDATION: kasa hareketi kimliği geçersiz.".to_string());
    }

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;

    cash_in_fields_gate(amount_cents, &reason)?;
    if let Some(movement) = find_replayed_movement(
        &mut tx,
        &movement_id,
        &tenant_id,
        &shift_id,
        "IN",
        amount_cents,
        &reason,
        &actor_id,
    )
    .await?
    {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(movement);
    }

    let shift_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM shifts WHERE id = ? AND tenant_id = ?")
            .bind(&shift_id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    cash_in_gate(amount_cents, &reason, shift_status.as_deref())?;

    let (movement, inserted) = persist_movement(
        &mut tx,
        &movement_id,
        &tenant_id,
        &shift_id,
        "IN",
        amount_cents,
        &reason,
        &actor_id,
        role.as_str(),
        "cash:movement_in",
        &audit_lock,
    )
    .await?;
    if !inserted {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(movement);
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(movement)
}

#[cfg(test)]
mod tests {
    use super::{cash_in_gate, find_replayed_movement, movement_id_is_valid, persist_movement};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;
    use std::time::Duration;

    const TENANT: &str = "tnt_cash";
    const ACTOR: &str = "usr_cash";
    const SHIFT: &str = "shf_cash";

    async fn pool() -> (SqlitePool, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "kasam360_cash_idempotency_{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let pool = SqlitePoolOptions::new()
            .max_connections(3)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .busy_timeout(Duration::from_secs(10)),
            )
            .await
            .expect("izole kasa testi DB");
        sqlx::raw_sql(
            "CREATE TABLE cash_movements (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, shift_id TEXT NOT NULL,
                movement_type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
                reason TEXT NOT NULL, actor_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE audit_ledger (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sequence INTEGER NOT NULL UNIQUE,
                timestamp TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
                category TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL,
                payload TEXT NOT NULL, previous_hash TEXT NOT NULL,
                current_hash TEXT NOT NULL UNIQUE, hash_version INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )
        .execute(&pool)
        .await
        .expect("izole kasa test şeması");
        (pool, path)
    }

    async fn persist(
        conn: &mut sqlx::SqliteConnection,
        lock: &crate::services::audit_service::AuditLock<'_>,
        id: &str,
        amount_cents: i64,
    ) -> Result<(super::CashMovementDto, bool), String> {
        persist_movement(
            conn,
            id,
            TENANT,
            SHIFT,
            "IN",
            amount_cents,
            "Dış kasa",
            ACTOR,
            "CASHIER",
            "cash:movement_in",
            lock,
        )
        .await
    }

    #[test]
    fn cash_in_rejects_invalid_amount_reason_and_closed_or_missing_shift() {
        assert!(cash_in_gate(1, "Dış kasa", Some("OPEN")).is_ok());
        assert!(cash_in_gate(0, "Dış kasa", Some("OPEN")).is_err());
        assert!(cash_in_gate(-1, "Dış kasa", Some("OPEN")).is_err());
        assert!(cash_in_gate(1, "  ", Some("OPEN")).is_err());
        assert!(cash_in_gate(1, "Dış kasa", Some("CLOSED")).is_err());
        assert!(cash_in_gate(1, "Dış kasa", None).is_err());
    }

    #[test]
    fn movement_id_requires_correct_prefix_and_24_hex_characters() {
        assert!(movement_id_is_valid(
            "cmin_000000000000000000000000",
            "cmin"
        ));
        assert!(movement_id_is_valid(
            "cmout_000000000000000000000000",
            "cmout"
        ));
        assert!(!movement_id_is_valid(
            "cmout_000000000000000000000000",
            "cmin"
        ));
        assert!(!movement_id_is_valid("cmin_not-an-id", "cmin"));
    }

    #[tokio::test]
    async fn retry_reuses_record_and_audit_but_payload_change_conflicts() {
        let (pool, path) = pool().await;
        let audit_mutex = tokio::sync::Mutex::new(());
        let lock = crate::services::audit_service::AuditLock::new(audit_mutex.lock().await);
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("ilk tx");
        let (_, inserted) = persist(&mut tx, &lock, "cmin_000000000000000000000000", 450)
            .await
            .expect("ilk hareket");
        assert!(inserted);
        tx.commit().await.expect("ilk commit");

        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("retry tx");
        let (_, inserted) = persist(&mut tx, &lock, "cmin_000000000000000000000000", 450)
            .await
            .expect("aynı retry");
        assert!(!inserted);
        assert!(
            persist(&mut tx, &lock, "cmin_000000000000000000000000", 451)
                .await
                .expect_err("farklı tutar")
                .starts_with("IDEMPOTENCY_CONFLICT")
        );
        let (_, distinct) = persist(&mut tx, &lock, "cmin_000000000000000000000001", 450)
            .await
            .expect("yeni hareket");
        assert!(
            distinct,
            "aynı tutarlı ayrı kullanıcı eylemi kendi kaydını alır"
        );
        tx.commit().await.expect("retry commit");

        let movements: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
            .fetch_one(&pool)
            .await
            .expect("hareket sayısı");
        let audits: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_ledger")
            .fetch_one(&pool)
            .await
            .expect("audit sayısı");
        assert_eq!(movements, 2);
        assert_eq!(audits, 2);
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn concurrent_same_request_commits_one_movement_and_one_audit() {
        let (pool, path) = pool().await;
        let audit_mutex = tokio::sync::Mutex::new(());
        let lock = crate::services::audit_service::AuditLock::new(audit_mutex.lock().await);
        let mut first = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .expect("ilk tx kilit alır");
        let second_pool = pool.clone();
        let second = tokio::spawn(async move {
            let other_mutex = tokio::sync::Mutex::new(());
            let other_lock =
                crate::services::audit_service::AuditLock::new(other_mutex.lock().await);
            let mut tx = second_pool
                .begin_with("BEGIN IMMEDIATE")
                .await
                .map_err(|error| error.to_string())?;
            let result =
                persist(&mut tx, &other_lock, "cmin_000000000000000000000000", 450).await?;
            tx.commit().await.map_err(|error| error.to_string())?;
            Ok::<_, String>(result.1)
        });
        let (_, first_inserted) = persist(&mut first, &lock, "cmin_000000000000000000000000", 450)
            .await
            .expect("ilk hareket");
        first.commit().await.expect("ilk commit");
        assert!(first_inserted);
        assert!(!second
            .await
            .expect("ikinci çağrı paniklemez")
            .expect("aynı işlem sonucu"));

        let movements: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
            .fetch_one(&pool)
            .await
            .expect("hareket sayısı");
        let audits: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_ledger")
            .fetch_one(&pool)
            .await
            .expect("audit sayısı");
        assert_eq!(movements, 1);
        assert_eq!(audits, 1);
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn replay_lookup_scopes_tenant_without_disclosing_foreign_payload() {
        let (pool, path) = pool().await;
        let audit_mutex = tokio::sync::Mutex::new(());
        let lock = crate::services::audit_service::AuditLock::new(audit_mutex.lock().await);
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("tx");
        persist(&mut tx, &lock, "cmin_000000000000000000000000", 450)
            .await
            .expect("hareket");
        let other_tenant = find_replayed_movement(
            &mut tx,
            "cmin_000000000000000000000000",
            "tnt_other",
            SHIFT,
            "IN",
            450,
            "Dış kasa",
            ACTOR,
        )
        .await
        .expect("tenant kapsamı");
        assert!(other_tenant.is_none());
        tx.rollback().await.expect("rollback");
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cash_out(
    movement_id: Option<String>,
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
    state.lan_sync.require_local_write()?;
    use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

    let tenant_id = crate::commands::command_helpers::require_tenant_id(tenant_id.as_deref())?;
    let movement_id = movement_id.unwrap_or_else(|| crate::id_generator::generate_id("cmout"));
    if !movement_id_is_valid(&movement_id, "cmout") {
        return Err("VALIDATION: kasa hareketi kimliği geçersiz.".to_string());
    }

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin_write().await.map_err(|e| e.to_string())?;
    let session_token = session_token.or(sessionToken);

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

    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    use crate::services::security360::money_gate as gate;
    gate::nakit_tutar_gecerli_mi(amount_cents)?;
    gate::gerekce_gecerli_mi(&reason)?;

    let manager_requires_owner_approval = actor_role == crate::rbac::Role::Manager.as_str();
    if let Some(movement) = find_approved_cash_out_replay(
        &mut tx,
        &movement_id,
        &tenant_id,
        &shift_id,
        amount_cents,
        &reason,
        &actor_id,
        actor_role.as_str(),
    )
    .await?
    {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(movement);
    }

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

    if manager_requires_owner_approval {
        let token = gate::onay_jetonunu_zorunlu_kil(jeton.as_deref())?;
        let kaynak = format!("CASH_OUT:{}:{}", shift_id.trim(), movement_id);

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
        if approver.approver_role != crate::rbac::Role::Owner {
            return Err(crate::approval_service::error::APPROVER_NOT_ALLOWED.to_string());
        }

        let ctx = AuditContext::new(
            tenant_id.clone(),
            approver.approver_id.clone(),
            approver.approver_role.as_str().to_string(),
            category::GUVENLIK,
            "approval:consumed",
            movement_id.clone(),
            serde_json::json!({
                "operation": crate::approval_service::operation::CASH_OUT,
                "amountCents": amount_cents,
                "actorId": request.actor_id,
                "approverId": approver.approver_id,
                "approverRole": approver.approver_role.as_str(),
            }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    }

    let (movement, inserted) = persist_movement(
        &mut tx,
        &movement_id,
        &tenant_id,
        &shift_id,
        "OUT",
        amount_cents,
        &reason,
        &actor_id,
        &actor_role,
        "cash:movement_out",
        &audit_lock,
    )
    .await?;
    if !inserted {
        return Err("IDEMPOTENCY_CONFLICT: kasa hareketi aynı anda işlendi.".to_string());
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(movement)
}
