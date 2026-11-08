//! Günlük çoğaltma: otoriteden takipçiye taşıma, onay ve uygulama.

use super::engine::{majority, Effects, Engine, Message, Role};
use super::op_log::{self, Operation};
use super::rejoin::rollback_reason;
use super::store::{self, LogEntry};
use crate::services::audit_service::AuditLock;

const BATCH_LIMIT: i64 = 64;

impl Engine {
    pub(super) async fn replicate_all(&mut self, effects: &mut Effects) -> Result<(), String> {
        if self.role != Role::Leader {
            return Ok(());
        }
        for peer in self.peers().await? {
            let message = self.append_for(&peer).await?;
            effects.send.push((peer, message));
        }
        Ok(())
    }

    /// Kalan cihazı tek başına otorite yapar; diğer cihazlar kalıcı olarak kaybolduysa
    /// işletmeyi durmaktan kurtaran tek çıkıştır.
    ///
    /// Çoğunluk şartını bilerek aşar: bu yüzden kararı yalnız işletme sahibi verir.
    /// Elindeki bütün kayıtlar onaylanır, çünkü bir kısmı kasiyere "tamam" denmiş olabilir.
    pub async fn take_over(&mut self, operation: &Operation) -> Result<Effects, String> {
        let row = self.cluster().await?;
        {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::save_vote(&mut conn, row.term + 1, Some(&self.me)).await?;
        }
        self.role = Role::Leader;
        self.leader_id = Some(self.me.clone());
        self.next_index.clear();
        self.match_index.clear();
        self.last_ack.clear();
        let mut effects = Effects::default();
        self.append_local(operation, &mut effects).await?;
        Ok(effects)
    }

    /// Düzenli kalp atışı: eksik kayıtları taşır ve otoriteyi duyurur.
    pub async fn on_heartbeat(&mut self, now: u64) -> Result<Effects, String> {
        self.now_hint = now;
        let mut effects = Effects::default();
        // Geçici hatayla veya kapanışla yarım kalan onaylı kayıt yeni yazma beklemez.
        self.apply_committed(&mut effects).await?;
        // Otorite yeniden görüldüyse ada kayıtları birleşmeye yollanır.
        self.push_merge(&mut effects).await?;
        self.replicate_all(&mut effects).await?;
        Ok(effects)
    }

    pub(super) async fn append_for(&self, peer: &str) -> Result<Message, String> {
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

    pub(super) async fn on_append(
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

        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
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
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::save_commit(&mut conn, new_commit).await?;
        }
        self.apply_committed(effects).await?;
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

    pub(super) async fn on_append_reply(
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
            let before = row.commit_index;
            self.advance_commit(effects).await?;
            // Onay kalp atışını beklemez: kaynak cihaz sonucu hemen alır, sonraki yazma
            // eski duruma dayanıp boşuna reddedilmez.
            if self.cluster().await?.commit_index > before {
                self.replicate_all(effects).await?;
            }
        } else {
            let (own_last, _) = self.last_position(&row).await?;
            let current = self.next_index.get(from).copied().unwrap_or(own_last + 1);
            // Geride kalan cihaz kendi sonundan devam eder; aynı konumda çakışma
            // varsa bir adım geri gidilir. Anlık görüntünün altına inilmez.
            let next = if current > last_index + 1 {
                last_index + 1
            } else {
                current - 1
            };
            self.next_index.insert(from.to_string(), next.max(1));
            let message = self.append_for(from).await?;
            effects.send.push((from.to_string(), message));
        }
        Ok(())
    }

    /// Çoğunluğun diske yazdığı, bu döneme ait son konuma kadar onaylar.
    pub(super) async fn advance_commit(&mut self, effects: &mut Effects) -> Result<(), String> {
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

    pub(super) async fn apply_committed(&mut self, effects: &mut Effects) -> Result<(), String> {
        // Ada değişikliği üzerine küme kaydı uygulanmaz: önce geri alınır. Otorite yoksa
        // geri alma da yapılmaz; ada kayıtları görünür kalır, uygulama bekler.
        if !self.settle_island().await? {
            return Ok(());
        }
        let row = self.cluster().await?;
        let pending = {
            let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
            store::proposed_up_to(&mut conn, &self.tenant_id, row.commit_index).await?
        };
        // Çok cihazda komut denetim kilidini tutarak onay bekler; uygulama aynı kilidi
        // beklerse ikisi kilitlenirdi. Bu modda defteri yalnız bu döngü kalıcı yazar.
        let replicated = self.members().await?.len() > 1;
        let private = tokio::sync::Mutex::new(());
        for operation in pending {
            let guard = if replicated {
                private.lock().await
            } else {
                self.audit.lock().await
            };
            let lock = AuditLock::new(guard);
            let Ok(mut tx) = self.pool.begin_with("BEGIN IMMEDIATE").await else {
                return Ok(());
            };
            match op_log::apply_proposed(&mut tx, &lock, &operation, &self.me).await {
                Ok(outcome) => {
                    tx.commit().await.map_err(|e| e.to_string())?;
                    if let Some(reason) = rollback_reason(&self.me, &operation, &outcome) {
                        self.halted = Some(reason);
                    }
                    effects.applied.push(outcome);
                }
                // Yoğun anda yazma kilidi alınamadı: kayıt durur, sonraki turda uygulanır.
                Err(reason) if reason.contains("database is locked") => return Ok(()),
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
