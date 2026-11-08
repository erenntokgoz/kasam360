//! Ada cihazının kümeye dönüşü: geri alma, birleşme önerisi, geri sarılma reddi.
//!
//! Sıra kesindir: otorite görülür → ada değişiklikleri geri alınır → bekleyen küme
//! kayıtları uygulanır → ada işlemleri `ISLAND_MERGE` olarak önerilir. Böylece ada
//! cihazı birleşme konumuna diğer cihazlarla aynı durumda gelir.

use super::engine::{Effects, Engine, Message, Role, LEASE_MS};
use super::island;
use super::island_queue;
use super::op_log::{LogOp, Operation, OperationOutcome, OperationStatus};

impl Engine {
    /// Otorite erişilebilir mi: bu cihaz çoğunluğu gören otorite ya da otoriteden yakın
    /// zamanda haber alan takipçi.
    pub(super) async fn authority_ok(&self) -> Result<bool, String> {
        if self.role == Role::Leader {
            return self.has_quorum(self.now_hint).await;
        }
        Ok(self.leader_id.is_some()
            && self
                .last_leader_contact
                .is_some_and(|seen| self.now_hint.saturating_sub(seen) < LEASE_MS))
    }

    /// Küme kaydı uygulanabilir mi? Yerel ada kaydı varsa ve otorite görülüyorsa önce
    /// geri alınır; otorite yoksa uygulama bekletilir.
    pub(super) async fn settle_island(&mut self) -> Result<bool, String> {
        let has_local = {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            island::has_local(&mut conn, &self.tenant_id).await?
        };
        if !has_local {
            return Ok(true);
        }
        if !self.authority_ok().await? {
            return Ok(false);
        }
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let undone = island_queue::undo_local(&mut tx, &self.tenant_id).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        tracing::info!("Ada kaydı birleşme için sıraya alındı: {undone} işlem");
        Ok(true)
    }

    /// Bekleyen ada işlemlerini otoriteye önerir; uygulanana kadar her kalp atışında
    /// aynı kimlikle yinelenir.
    pub(super) async fn push_merge(&mut self, effects: &mut Effects) -> Result<(), String> {
        if self.halted.is_some() || !self.authority_ok().await? {
            return Ok(());
        }
        if !self.settle_island().await? {
            return Ok(());
        }
        let operation = {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            island_queue::next_batch(&mut conn, &self.tenant_id, &self.me).await?
        };
        let Some(operation) = operation else {
            return Ok(());
        };
        if self.role == Role::Leader {
            match self.propose(&operation, self.now_hint).await {
                Ok(result) => {
                    effects.send.extend(result.send);
                    effects.applied.extend(result.applied);
                }
                Err(reason) => tracing::warn!("Ada birleşmesi önerilemedi: {reason}"),
            }
        } else if let Some(leader) = self.leader_id.clone() {
            effects.send.push((
                leader,
                Message::Forward {
                    operation: Box::new(operation),
                },
            ));
        }
        Ok(())
    }
}

/// Bu cihazın birleşmesi geri sarılmış günlük nedeniyle reddedildiyse durma gerekçesi:
/// eksik geçmişle yazmaya devam etmek kayıp kaydı gizlerdi.
pub(super) fn rollback_reason(
    me: &str,
    operation: &Operation,
    outcome: &OperationOutcome,
) -> Option<String> {
    let own_merge = matches!(operation.op, LogOp::IslandMerge(_)) && operation.device_id == me;
    let rolled_back = outcome.status == OperationStatus::Rejected
        && outcome
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with("ROLLED_BACK"));
    (own_merge && rolled_back)
        .then(|| outcome.error.clone())
        .flatten()
}
