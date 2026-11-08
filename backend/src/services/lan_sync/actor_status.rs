//! Durum çubuğu yayını: otorite, ada ve eşitleme durumunun hesaplanması.

use super::super::engine::{Role, LEASE_MS};
use super::super::runtime::{MemberStatus, SyncStatus};
use super::super::store;
use super::{Actor, ISLAND_AFTER_MS};

impl Actor {
    pub(super) async fn publish(&mut self, now: u64) -> Result<(), String> {
        let row = self.engine.cluster().await?;
        let members = self.engine.members().await?;
        let (last_index, membership_pending, island_local, island_queued) = {
            let mut conn = self
                .sync
                .inner
                .pool
                .acquire()
                .await
                .map_err(|e| e.to_string())?;
            let (last_index, _) = store::last_position(&mut conn, &row).await?;
            let pending = store::has_pending_membership(&mut conn, &row.tenant_id).await?;
            let local = super::super::island::has_local(&mut conn, &row.tenant_id).await?;
            let queued = super::super::island_queue::has_queued(&mut conn, &row.tenant_id).await?;
            (last_index, pending, local, queued)
        };
        let is_leader = self.engine.role == Role::Leader;
        let authority_alive = if is_leader {
            self.engine.has_quorum(now).await?
        } else {
            self.engine
                .last_leader_contact
                .is_some_and(|seen| now.saturating_sub(seen) < LEASE_MS)
        };
        let behind = is_leader
            && members.iter().any(|member| {
                // Kapalı cihaz beklenmez: çoğunluk varken ekran "Eşitleniyor"da takılmamalı.
                self.peers.contains_key(&member.device_id)
                    && self.engine.match_index.get(&member.device_id).copied() != Some(last_index)
            });
        if authority_alive || self.authority_seen == 0 {
            self.authority_seen = now;
        }
        let is_member = members.iter().any(|member| member.device_id == self.me);
        // Ada: otoritesiz yazma kalıcıdır, birleşmeyi bekler. Üyelikten çıkmış cihaz adaya
        // geçmez; onun yazması hiçbir kümede birleşemezdi.
        let island = is_member
            && !authority_alive
            && (island_local || now.saturating_sub(self.authority_seen) >= ISLAND_AFTER_MS);
        let state = if self.engine.halted.is_some() {
            "INTERVENTION"
        } else if !self.unresolved.is_empty() {
            "VERIFYING"
        } else if island {
            "ISLAND"
        } else if !authority_alive {
            "NO_CONNECTION"
        } else if behind || membership_pending || island_local || island_queued {
            "SYNCING"
        } else {
            "READY"
        };
        let mut statuses = Vec::with_capacity(members.len());
        for member in members {
            let last_seen: Option<Option<String>> =
                sqlx::query_scalar("SELECT last_seen FROM sync_peers WHERE device_id = ?")
                    .bind(&member.device_id)
                    .fetch_optional(&self.sync.inner.pool)
                    .await
                    .map_err(|e| e.to_string())?;
            statuses.push(MemberStatus {
                connected: self.peers.contains_key(&member.device_id),
                is_authority: self.engine.leader_id.as_deref() == Some(member.device_id.as_str()),
                is_local: member.device_id == self.me,
                acknowledged_index: self.engine.match_index.get(&member.device_id).copied(),
                last_seen: last_seen.flatten(),
                device_id: member.device_id,
                name: member.name,
            });
        }
        self.sync.publish(SyncStatus {
            mode: "CLUSTER",
            state,
            role: Some(self.engine.role),
            term: row.term,
            commit_index: row.commit_index,
            detail: self.engine.halted.clone(),
            members: statuses,
        });
        Ok(())
    }
}
