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
use super::pairing::{self, JoinGrant, JoinRequest};
use super::store::{self, ClusterRow, LogEntry, Member};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Otoritenin çoğunluğu hâlâ gördüğünü kabul ettiği süre.
pub const LEASE_MS: u64 = 2_000;
/// Otoriteden bu süre içinde haber alan cihaz yeni seçime oy vermez.
pub const LEADER_SILENCE_MS: u64 = 1_500;

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
        operation: Box<Operation>,
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
    pub(super) pool: SqlitePool,
    pub(super) audit: Arc<Mutex<()>>,
    pub me: String,
    pub tenant_id: String,
    pub role: Role,
    pub leader_id: Option<String>,
    pub(super) votes: BTreeSet<String>,
    pub(super) next_index: BTreeMap<String, i64>,
    pub match_index: BTreeMap<String, i64>,
    pub(super) last_ack: BTreeMap<String, u64>,
    pub last_leader_contact: Option<u64>,
    /// Doluysa cihaz yeni işlem kabul etmez; insan müdahalesi gerekir.
    pub halted: Option<String>,
}

pub(super) fn majority(count: usize) -> usize {
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

    pub(super) async fn peers(&self) -> Result<Vec<String>, String> {
        Ok(self
            .members()
            .await?
            .into_iter()
            .map(|member| member.device_id)
            .filter(|id| id != &self.me)
            .collect())
    }

    pub(super) async fn last_position(&self, row: &ClusterRow) -> Result<(i64, i64), String> {
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

    pub(super) async fn step_down(&mut self, term: i64) -> Result<(), String> {
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

    pub(super) async fn become_leader(
        &mut self,
        now: u64,
        effects: &mut Effects,
    ) -> Result<(), String> {
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

    /// Yeni cihazı kabul eder: kodu tüketir, anlık görüntüyü alır, üyeliği ekler.
    ///
    /// Anlık görüntü onay konumunu kapsar; sonrası günlükle taşındığından kayıt
    /// kaybı olmaz. Üye eklendiği an çoğunluk hesabına girer.
    pub async fn admit(
        &mut self,
        request: &JoinRequest,
        address: &str,
        now: u64,
    ) -> Result<(JoinGrant, Effects), String> {
        let row = self.cluster().await?;
        let mut members = self.members().await?;
        if !members.iter().any(|m| m.device_id == self.me) {
            return Err("CONFLICT: bu cihaz üyelikte değil".to_string());
        }
        if members.iter().any(|m| m.device_id == request.device_id) {
            return Err("CONFLICT: cihaz zaten üye".to_string());
        }
        let grant = {
            let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
            if store::has_pending_membership(&mut tx, &self.tenant_id).await? {
                return Err("CONFLICT: önceki üyelik değişikliği onay bekliyor".to_string());
            }
            pairing::consume_code(&mut tx, &self.tenant_id).await?;
            let base_term = store::term_at(&mut tx, &row, row.commit_index)
                .await?
                .ok_or_else(|| "INTERNAL: onay konumu bulunamadı".to_string())?;
            let snapshot = pairing::export_snapshot(&mut tx, &self.tenant_id).await?;
            tx.commit().await.map_err(|e| e.to_string())?;
            JoinGrant {
                tenant_id: self.tenant_id.clone(),
                cluster_id: row.cluster_id,
                authority_id: self.me.clone(),
                term: row.term,
                base_index: row.commit_index,
                base_term,
                base_members: members.clone(),
                snapshot,
            }
        };
        members.push(Member {
            device_id: request.device_id.clone(),
            name: request.name.clone(),
            public_key: request.public_key.clone(),
            address: address.to_string(),
        });
        let operation = Operation {
            operation_id: crate::id_generator::generate_id("op"),
            tenant_id: self.tenant_id.clone(),
            device_id: self.me.clone(),
            actor_id: "SYSTEM".to_string(),
            actor_role: "System".to_string(),
            intent_sha256: String::new(),
            op: LogOp::SetMembers(members),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        // Yeni üye hemen görülmüş sayılır; yoksa katılım anında çoğunluk düşerdi.
        self.last_ack.insert(request.device_id.clone(), now);
        let effects = self.propose(&operation, now).await?;
        Ok((grant, effects))
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
                // Kimlik bağlantıdan gelir; iletinin kendi beyanına güvenilmez.
                let allowed = operation.tenant_id == self.tenant_id
                    && operation.device_id == from
                    && matches!(operation.op, LogOp::Cari(_));
                let proposed = if allowed {
                    self.propose(&operation, now).await
                } else {
                    Err("UNAUTHORIZED: iletilen işlem kapsam dışında".to_string())
                };
                match proposed {
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
}

#[cfg(test)]
#[path = "engine_sim.rs"]
mod sim;

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
