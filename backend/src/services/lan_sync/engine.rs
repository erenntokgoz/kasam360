//! Tek otorite ve kalıcı çoğunluk onayı.
//!
//! Ağ bilmeyen durum makinesi: giriş iletisini işler, diske yazar, gönderilecek
//! iletileri döndürür. Böylece cihaz kaybı ve bölünme senaryoları gerçek SQLite
//! dosyalarıyla, saat beklemeden sınanır.
//!
//! Kurallar Raft tabanlıdır: her dönemde en çok bir otorite vardır; işlem ancak
//! üyelerin çoğunluğu diske yazdığını bildirince uygulanır; günlüğü geride olan
//! cihaz otorite seçilemez. Çoğunluk yoksa işlem günlüğe bile alınmaz, bu yüzden
//! iki cihazdan biri kaybolunca kalan cihaz finansal yazmayı durdurur.

use super::op_log::{self, LogOp, Operation, OperationOutcome, OperationStatus};
use super::store::{self, ClusterRow, LogEntry, Member};
use crate::services::audit_service::AuditLock;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Otoritenin çoğunluğu hâlâ gördüğünü kabul ettiği süre.
pub const LEASE_MS: u64 = 2_000;
/// Otoriteden bu süre içinde haber alan cihaz yeni seçime oy vermez.
pub const LEADER_SILENCE_MS: u64 = 1_500;
const BATCH_LIMIT: i64 = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Message {
    VoteRequest {
        term: i64,
        last_index: i64,
        last_term: i64,
    },
    VoteReply {
        term: i64,
        granted: bool,
    },
    Append {
        term: i64,
        prev_index: i64,
        prev_term: i64,
        entries: Vec<LogEntry>,
        commit_index: i64,
    },
    AppendReply {
        term: i64,
        success: bool,
        /// Başarıda onaylanan son konum; rette yanıtlayanın son konumu.
        last_index: i64,
    },
    Forward {
        operation: Operation,
    },
    ForwardRejected {
        operation_id: String,
        error: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    Follower,
    Candidate,
    Leader,
}

#[derive(Debug, Default)]
pub struct Effects {
    pub send: Vec<(String, Message)>,
    /// Bu cihazda kalıcı olarak sonuçlanan işlemler.
    pub applied: Vec<OperationOutcome>,
    /// Günlüğe alınmadan reddedilen işlemler; aynı kimlikle yeniden denenebilir.
    pub rejected: Vec<(String, String)>,
}

pub struct Engine {
    pool: SqlitePool,
    audit: Arc<Mutex<()>>,
    pub me: String,
    pub tenant_id: String,
    pub role: Role,
    pub leader_id: Option<String>,
    votes: BTreeSet<String>,
    next_index: BTreeMap<String, i64>,
    pub match_index: BTreeMap<String, i64>,
    last_ack: BTreeMap<String, u64>,
    pub last_leader_contact: Option<u64>,
    /// Doluysa cihaz yeni işlem kabul etmez; insan müdahalesi gerekir.
    pub halted: Option<String>,
}

fn majority(count: usize) -> usize {
    count / 2 + 1
}

impl Engine {
    pub async fn open(
        pool: SqlitePool,
        audit: Arc<Mutex<()>>,
        me: String,
    ) -> Result<Option<Self>, String> {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let Some(row) = store::load_cluster(&mut conn).await? else {
            return Ok(None);
        };
        drop(conn);
        Ok(Some(Self {
            pool,
            audit,
            me,
            tenant_id: row.tenant_id,
            role: Role::Follower,
            leader_id: None,
            votes: BTreeSet::new(),
            next_index: BTreeMap::new(),
            match_index: BTreeMap::new(),
            last_ack: BTreeMap::new(),
            last_leader_contact: None,
            halted: None,
        }))
    }

    pub async fn cluster(&self) -> Result<ClusterRow, String> {
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        store::load_cluster(&mut conn)
            .await?
            .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())
    }

    pub async fn members(&self) -> Result<Vec<Member>, String> {
        let row = self.cluster().await?;
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        store::current_members(&mut conn, &row).await
    }

    async fn peers(&self) -> Result<Vec<String>, String> {
        Ok(self
            .members()
            .await?
            .into_iter()
            .map(|member| member.device_id)
            .filter(|id| id != &self.me)
            .collect())
    }

    async fn last_position(&self, row: &ClusterRow) -> Result<(i64, i64), String> {
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        store::last_position(&mut conn, row).await
    }

    /// Otorite çoğunluğu `LEASE_MS` içinde gördü mü? Tek üyede her zaman evet.
    pub async fn has_quorum(&self, now: u64) -> Result<bool, String> {
        let members = self.members().await?;
        if self.role != Role::Leader {
            return Ok(false);
        }
        let recent = members
            .iter()
            .filter(|member| member.device_id != self.me)
            .filter(|member| {
                self.last_ack
                    .get(&member.device_id)
                    .is_some_and(|ack| now.saturating_sub(*ack) < LEASE_MS)
            })
            .count();
        let self_vote = usize::from(members.iter().any(|m| m.device_id == self.me));
        Ok(recent + self_vote >= majority(members.len()))
    }

    async fn step_down(&mut self, term: i64) -> Result<(), String> {
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        store::save_vote(&mut conn, term, None).await?;
        self.role = Role::Follower;
        self.leader_id = None;
        self.votes.clear();
        Ok(())
    }

    /// Otoriteden haber yok: dönemi artırıp seçim başlatır.
    pub async fn on_election_timeout(&mut self, now: u64) -> Result<Effects, String> {
        let mut effects = Effects::default();
        if self.role == Role::Leader || self.halted.is_some() {
            return Ok(effects);
        }
        let row = self.cluster().await?;
        let members = self.members().await?;
        if !members.iter().any(|m| m.device_id == self.me) {
            return Ok(effects);
        }
        let term = row.term + 1;
        {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::save_vote(&mut conn, term, Some(&self.me)).await?;
        }
        self.role = Role::Candidate;
        self.leader_id = None;
        self.votes = BTreeSet::from([self.me.clone()]);
        if self.votes.len() >= majority(members.len()) {
            self.become_leader(now, &mut effects).await?;
            return Ok(effects);
        }
        let (last_index, last_term) = self.last_position(&row).await?;
        for peer in self.peers().await? {
            effects.send.push((
                peer,
                Message::VoteRequest {
                    term,
                    last_index,
                    last_term,
                },
            ));
        }
        Ok(effects)
    }

    async fn become_leader(&mut self, now: u64, effects: &mut Effects) -> Result<(), String> {
        let row = self.cluster().await?;
        let (last_index, _) = self.last_position(&row).await?;
        self.role = Role::Leader;
        self.leader_id = Some(self.me.clone());
        self.next_index.clear();
        self.match_index.clear();
        self.last_ack.clear();
        for peer in self.peers().await? {
            self.next_index.insert(peer.clone(), last_index + 1);
            self.match_index.insert(peer.clone(), row.base_index);
            // Seçimde oy veren cihazlar az önce görülmüştür.
            if self.votes.contains(&peer) {
                self.last_ack.insert(peer, now);
            }
        }
        // Önceki dönemin kayıtları ancak bu dönemin bir kaydıyla onaylanabilir.
        let noop = Operation {
            operation_id: format!("noop_{}_{}", row.term, self.me),
            tenant_id: self.tenant_id.clone(),
            device_id: self.me.clone(),
            actor_id: "SYSTEM".to_string(),
            actor_role: "System".to_string(),
            intent_sha256: String::new(),
            op: LogOp::Noop,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.append_local(&noop, effects).await
    }

    async fn append_local(
        &mut self,
        operation: &Operation,
        effects: &mut Effects,
    ) -> Result<(), String> {
        let row = self.cluster().await?;
        {
            let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
            let (last_index, _) = store::last_position(&mut tx, &row).await?;
            op_log::append(&mut tx, operation, last_index + 1, row.term).await?;
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        self.advance_commit(effects).await?;
        self.replicate_all(effects).await
    }

    /// Yeni işlemi kabul eder. Çoğunluk yoksa günlüğe almadan reddeder.
    pub async fn propose(&mut self, operation: &Operation, now: u64) -> Result<Effects, String> {
        let mut effects = Effects::default();
        if let Some(reason) = &self.halted {
            return Err(format!("INTERVENTION: {reason}"));
        }
        if self.role != Role::Leader {
            return Err("NOT_LEADER: bu cihaz işlem otoritesi değil".to_string());
        }
        {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            let known = op_log::lookup(
                &mut conn,
                &self.tenant_id,
                &operation.operation_id,
                Some(&operation.intent_sha256),
            )
            .await?;
            if let Some(outcome) = known {
                if outcome.status != OperationStatus::Pending {
                    effects.applied.push(outcome);
                }
                return Ok(effects);
            }
            if matches!(operation.op, LogOp::SetMembers(_))
                && store::has_pending_membership(&mut conn, &self.tenant_id).await?
            {
                return Err("CONFLICT: önceki üyelik değişikliği onay bekliyor".to_string());
            }
        }
        // Üyelik çıkarma, cihazı kaybeden otoritenin tek güvenli çıkışıdır;
        // yeni üyelikte eski çoğunlukla kesişim korunur.
        let is_membership = matches!(operation.op, LogOp::SetMembers(_));
        if !is_membership && !self.has_quorum(now).await? {
            return Err(
                "QUORUM_LOST: çoğunluk yok; finansal yazma güvenli biçimde durduruldu".to_string(),
            );
        }
        self.append_local(operation, &mut effects).await?;
        Ok(effects)
    }

    async fn replicate_all(&mut self, effects: &mut Effects) -> Result<(), String> {
        if self.role != Role::Leader {
            return Ok(());
        }
        for peer in self.peers().await? {
            let message = self.append_for(&peer).await?;
            effects.send.push((peer, message));
        }
        Ok(())
    }

    /// Düzenli kalp atışı: eksik kayıtları taşır ve otoriteyi duyurur.
    pub async fn on_heartbeat(&mut self) -> Result<Effects, String> {
        let mut effects = Effects::default();
        self.replicate_all(&mut effects).await?;
        Ok(effects)
    }

    async fn append_for(&self, peer: &str) -> Result<Message, String> {
        let row = self.cluster().await?;
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        let (last_index, _) = store::last_position(&mut conn, &row).await?;
        let next = self
            .next_index
            .get(peer)
            .copied()
            .unwrap_or(last_index + 1)
            .max(row.base_index + 1);
        let prev_index = next - 1;
        let prev_term = store::term_at(&mut conn, &row, prev_index)
            .await?
            .ok_or_else(|| "INTERNAL: günlük konumu bulunamadı".to_string())?;
        let entries = store::entries_from(&mut conn, &self.tenant_id, next, BATCH_LIMIT).await?;
        Ok(Message::Append {
            term: row.term,
            prev_index,
            prev_term,
            entries,
            commit_index: row.commit_index,
        })
    }

    pub async fn handle(
        &mut self,
        from: &str,
        message: Message,
        now: u64,
    ) -> Result<Effects, String> {
        let mut effects = Effects::default();
        match message {
            Message::VoteRequest {
                term,
                last_index,
                last_term,
            } => {
                self.on_vote_request(from, term, last_index, last_term, now, &mut effects)
                    .await?
            }
            Message::VoteReply { term, granted } => {
                self.on_vote_reply(from, term, granted, now, &mut effects)
                    .await?
            }
            Message::Append {
                term,
                prev_index,
                prev_term,
                entries,
                commit_index,
            } => {
                self.on_append(
                    from,
                    term,
                    prev_index,
                    prev_term,
                    entries,
                    commit_index,
                    now,
                    &mut effects,
                )
                .await?
            }
            Message::AppendReply {
                term,
                success,
                last_index,
            } => {
                self.on_append_reply(from, term, success, last_index, now, &mut effects)
                    .await?
            }
            Message::Forward { operation } => {
                let operation_id = operation.operation_id.clone();
                match self.propose(&operation, now).await {
                    Ok(result) => {
                        // İletilen işlemin sonucu kaynak cihaza günlükle ulaşır.
                        effects.send.extend(result.send);
                        effects.applied.extend(result.applied);
                    }
                    Err(error) => effects.send.push((
                        from.to_string(),
                        Message::ForwardRejected {
                            operation_id,
                            error,
                        },
                    )),
                }
            }
            Message::ForwardRejected {
                operation_id,
                error,
            } => effects.rejected.push((operation_id, error)),
        }
        Ok(effects)
    }

    async fn on_vote_request(
        &mut self,
        from: &str,
        term: i64,
        last_index: i64,
        last_term: i64,
        now: u64,
        effects: &mut Effects,
    ) -> Result<(), String> {
        let row = self.cluster().await?;
        let is_member = self.members().await?.iter().any(|m| m.device_id == from);
        // Ayrılan ya da kısa süre kopan cihaz çalışan otoriteyi düşüremez.
        let leader_alive = self
            .last_leader_contact
            .is_some_and(|seen| now.saturating_sub(seen) < LEADER_SILENCE_MS)
            || self.has_quorum(now).await?;
        if !is_member || leader_alive {
            effects.send.push((
                from.to_string(),
                Message::VoteReply {
                    term: row.term,
                    granted: false,
                },
            ));
            return Ok(());
        }
        if term > row.term {
            self.step_down(term).await?;
        }
        let row = self.cluster().await?;
        let (my_index, my_term) = self.last_position(&row).await?;
        let log_ok = (last_term, last_index) >= (my_term, my_index);
        let can_vote = row.voted_for.as_deref().is_none_or(|id| id == from);
        let granted = term == row.term && can_vote && log_ok;
        if granted {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::save_vote(&mut conn, term, Some(from)).await?;
            self.last_leader_contact = Some(now);
        }
        effects.send.push((
            from.to_string(),
            Message::VoteReply {
                term: row.term,
                granted,
            },
        ));
        Ok(())
    }

    async fn on_vote_reply(
        &mut self,
        from: &str,
        term: i64,
        granted: bool,
        now: u64,
        effects: &mut Effects,
    ) -> Result<(), String> {
        let row = self.cluster().await?;
        if term > row.term {
            return self.step_down(term).await;
        }
        if self.role != Role::Candidate || term != row.term || !granted {
            return Ok(());
        }
        self.votes.insert(from.to_string());
        if self.votes.len() >= majority(self.members().await?.len()) {
            self.become_leader(now, effects).await?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn on_append(
        &mut self,
        from: &str,
        term: i64,
        prev_index: i64,
        prev_term: i64,
        entries: Vec<LogEntry>,
        commit_index: i64,
        now: u64,
        effects: &mut Effects,
    ) -> Result<(), String> {
        let mut row = self.cluster().await?;
        if term < row.term {
            let (last_index, _) = self.last_position(&row).await?;
            effects.send.push((
                from.to_string(),
                Message::AppendReply {
                    term: row.term,
                    success: false,
                    last_index,
                },
            ));
            return Ok(());
        }
        if term > row.term {
            self.step_down(term).await?;
            row = self.cluster().await?;
        }
        self.role = Role::Follower;
        self.leader_id = Some(from.to_string());
        self.last_leader_contact = Some(now);

        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let matches_prev = store::term_at(&mut tx, &row, prev_index).await? == Some(prev_term);
        if !matches_prev {
            let (last_index, _) = store::last_position(&mut tx, &row).await?;
            tx.rollback().await.map_err(|e| e.to_string())?;
            effects.send.push((
                from.to_string(),
                Message::AppendReply {
                    term: row.term,
                    success: false,
                    last_index,
                },
            ));
            return Ok(());
        }
        let mut match_index = prev_index;
        for entry in &entries {
            match store::term_at(&mut tx, &row, entry.index).await? {
                Some(existing) if existing == entry.term => {}
                existing => {
                    if existing.is_some() {
                        if let Err(reason) =
                            store::truncate_from(&mut tx, &self.tenant_id, entry.index).await
                        {
                            self.halted = Some(reason.clone());
                            return Err(reason);
                        }
                    }
                    op_log::append(&mut tx, &entry.operation, entry.index, entry.term).await?;
                }
            }
            match_index = entry.index;
        }
        // Yanıt ancak kayıt diske inince gider: "kalıcı onay" budur.
        tx.commit().await.map_err(|e| e.to_string())?;

        let new_commit = commit_index.min(match_index);
        if new_commit > row.commit_index {
            {
                let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
                store::save_commit(&mut conn, new_commit).await?;
            }
            self.apply_committed(effects).await?;
        }
        effects.send.push((
            from.to_string(),
            Message::AppendReply {
                term: row.term,
                success: true,
                last_index: match_index,
            },
        ));
        Ok(())
    }

    async fn on_append_reply(
        &mut self,
        from: &str,
        term: i64,
        success: bool,
        last_index: i64,
        now: u64,
        effects: &mut Effects,
    ) -> Result<(), String> {
        let row = self.cluster().await?;
        if term > row.term {
            return self.step_down(term).await;
        }
        if self.role != Role::Leader || term != row.term {
            return Ok(());
        }
        self.last_ack.insert(from.to_string(), now);
        if success {
            let known = self.match_index.entry(from.to_string()).or_insert(0);
            *known = (*known).max(last_index);
            self.next_index.insert(from.to_string(), *known + 1);
            self.advance_commit(effects).await?;
        } else {
            let next = self
                .next_index
                .get(from)
                .copied()
                .unwrap_or(last_index + 1)
                .saturating_sub(1)
                .min(last_index + 1);
            self.next_index.insert(from.to_string(), next.max(1));
            let message = self.append_for(from).await?;
            effects.send.push((from.to_string(), message));
        }
        Ok(())
    }

    /// Çoğunluğun diske yazdığı, bu döneme ait son konuma kadar onaylar.
    async fn advance_commit(&mut self, effects: &mut Effects) -> Result<(), String> {
        let row = self.cluster().await?;
        let members = self.members().await?;
        let (last_index, _) = self.last_position(&row).await?;
        let mut positions: Vec<i64> = members
            .iter()
            .map(|member| {
                if member.device_id == self.me {
                    last_index
                } else {
                    self.match_index
                        .get(&member.device_id)
                        .copied()
                        .unwrap_or(row.base_index)
                }
            })
            .collect();
        positions.sort_unstable_by(|a, b| b.cmp(a));
        let Some(&candidate) = positions.get(majority(members.len()) - 1) else {
            return Ok(());
        };
        if candidate <= row.commit_index {
            return Ok(());
        }
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        if store::term_at(&mut conn, &row, candidate).await? != Some(row.term) {
            return Ok(());
        }
        store::save_commit(&mut conn, candidate).await?;
        drop(conn);
        self.apply_committed(effects).await?;
        if !self.members().await?.iter().any(|m| m.device_id == self.me) {
            self.role = Role::Follower;
            self.leader_id = None;
        }
        Ok(())
    }

    async fn apply_committed(&mut self, effects: &mut Effects) -> Result<(), String> {
        let row = self.cluster().await?;
        let pending = {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::proposed_up_to(&mut conn, &self.tenant_id, row.commit_index).await?
        };
        for operation in pending {
            let guard = self.audit.lock().await;
            let lock = AuditLock::new(guard);
            let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
            match op_log::apply_proposed(&mut tx, &lock, &operation).await {
                Ok(outcome) => {
                    tx.commit().await.map_err(|e| e.to_string())?;
                    effects.applied.push(outcome);
                }
                Err(reason) => {
                    // Onaylanmış kayıt atlanamaz: sıra bozulursa cihazlar ayrışır.
                    self.halted =
                        Some(format!("{} uygulanamadı: {reason}", operation.operation_id));
                    break;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
