//! Cari yazmalarının tek girişi ve işlem sonucu sorgusu.
//!
//! Komutlar doğrudan tablolara yazmaz; niyeti özetleyip işlem günlüğüne verir.
//! Böylece çift tıklama ya da zaman aşımı sonrası tekrar aynı sonucu döndürür.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant};
use crate::services::audit_service::AuditLock;
use crate::services::cari::CariOp;
use crate::services::device_identity::ensure_local_device;
use crate::services::lan_sync::op_log::{execute_local, intent_hash, lookup, LogOp};
use crate::services::lan_sync::{Operation, OperationOutcome};
use serde_json::Value;

/// İşlemi yürütür; reddedilen ya da sonucu bilinmeyen işlem `Err` döner.
pub(crate) async fn submit(
    pool: &DbPool,
    state: &crate::AppState,
    tenant_id: &str,
    operation_id: &str,
    actor_id: Option<String>,
    actor_role: Option<String>,
    intent: Value,
    op: CariOp,
) -> Result<Value, String> {
    let device_id = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        ensure_local_device(&mut conn, tenant_id).await?
    };
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let operation = Operation {
        operation_id: operation_id.trim().to_string(),
        tenant_id: tenant_id.to_string(),
        device_id,
        actor_id,
        actor_role,
        intent_sha256: intent_hash(op.kind(), &intent),
        created_at: chrono::Utc::now().to_rfc3339(),
        op: LogOp::Cari(Box::new(op)),
    };
    if state.lan_sync.status().mode == "CLUSTER" {
        if let LogOp::Cari(op) = &operation.op {
            state.lan_sync.require_replicable(op)?;
        }
        return state.lan_sync.submit(operation).await?.into_result();
    }
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    execute_local(pool, &audit_lock, &operation)
        .await?
        .into_result()
}

/// Zaman aşımından sonra işlemin kesin durumunu verir; yeniden yazmaz.
#[tauri::command]
pub async fn get_operation_result(
    operation_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<OperationOutcome, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    Ok(lookup(&mut conn, &tid, &operation_id, None)
        .await?
        .unwrap_or_else(|| OperationOutcome::unknown(&operation_id)))
}
