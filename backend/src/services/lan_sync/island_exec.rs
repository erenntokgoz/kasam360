//! Kimlikli işlemlerin (cari) kümede ya da adada yürütülmesi.
//!
//! Cari komutu niyetini işlem kimliğiyle verir. Otorite erişilebilirse işlem küme
//! günlüğünden geçer; otorite yoksa ya da cihazda birleşmeyi bekleyen ada kaydı varsa
//! aynı kimlikle yerelde yürütülür ve ada kaydına girer. Kimlik korunduğu için tekrar
//! gelen istek ikinci kez yazılmaz; birleşmede de aynı kimlikle görünür.

use super::actor::NO_AUTHORITY;
use super::island::{self, IslandBase};
use super::island_queue::{self, SealMeta};
use super::op_log::{self, LogOp, Operation, OperationOutcome, OperationStatus};
use super::runtime::LanSync;
use super::store;
use crate::services::audit_service::AuditLock;
use crate::services::cari::{self, ApplyError};
use crate::services::device_identity::ensure_local_device;
use tokio::sync::Mutex;

impl LanSync {
    /// İşlemi yürütür; otoritesizlik işlemi durdurmaz.
    pub async fn execute(
        &self,
        operation: Operation,
        audit: &Mutex<()>,
    ) -> Result<OperationOutcome, String> {
        let island_pending = {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            island::has_local(&mut conn, &operation.tenant_id).await?
        };
        if !island_pending && self.status().state != "ISLAND" {
            match self.submit(operation.clone()).await {
                // Günlüğe girmedi; aynı kimlikle adada yürütmek güvenlidir.
                Err(error) if error == NO_AUTHORITY || error.starts_with("QUORUM_LOST") => {}
                other => return other,
            }
        }
        self.execute_island(&operation, audit).await
    }

    async fn execute_island(
        &self,
        operation: &Operation,
        audit: &Mutex<()>,
    ) -> Result<OperationOutcome, String> {
        let LogOp::Cari(op) = &operation.op else {
            return Err("SYNC_UNSUPPORTED: bu işlem ada kipinde yürütülemez".to_string());
        };
        // Denetim kilidi transaction'dan önce alınır; komutların kilit sırası korunur.
        let lock = AuditLock::new(audit.lock().await);
        let mut tx = self
            .inner
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        if let Some(existing) = op_log::lookup(
            &mut tx,
            &operation.tenant_id,
            &operation.operation_id,
            Some(&operation.intent_sha256),
        )
        .await?
        {
            return Ok(existing);
        }
        let row = store::load_cluster(&mut tx)
            .await?
            .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
        let me = ensure_local_device(&mut tx, &row.tenant_id).await?;
        let members = store::current_members(&mut tx, &row).await?;
        if row.tenant_id != operation.tenant_id
            || !members.iter().any(|member| member.device_id == me)
        {
            return Err(NO_AUTHORITY.to_string());
        }
        sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('ISLAND')")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let applied = cari::apply(
            &mut tx,
            &lock,
            &operation.tenant_id,
            &operation.actor_id,
            &operation.actor_role,
            &operation.created_at,
            op,
        )
        .await;
        let value = match applied {
            Ok(value) => value,
            Err(ApplyError::Rejected(message)) => {
                tx.rollback().await.map_err(|e| e.to_string())?;
                return Ok(OperationOutcome {
                    status: OperationStatus::Rejected,
                    error: Some(message),
                    ..OperationOutcome::unknown(&operation.operation_id)
                });
            }
            Err(ApplyError::Internal(message)) => return Err(message),
        };
        let base = IslandBase {
            tenant_id: row.tenant_id.clone(),
            device_id: me,
            base_commit_index: row.commit_index,
            base_state: row.state_index,
        };
        island_queue::seal(
            &mut tx,
            &base,
            SealMeta {
                operation_id: operation.operation_id.clone(),
                actor_id: operation.actor_id.clone(),
                actor_role: operation.actor_role.clone(),
                kind: operation.op.kind().to_string(),
                intent_sha256: Some(operation.intent_sha256.clone()),
                result: value.clone(),
            },
        )
        .await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(OperationOutcome {
            status: OperationStatus::Applied,
            result: Some(value),
            ..OperationOutcome::unknown(&operation.operation_id)
        })
    }
}
