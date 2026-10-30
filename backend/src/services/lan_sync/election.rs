//! Oy verme kuralları.
//!
//! Günlüğü geride olan cihaza oy verilmediği için onaylanmış kayıt yeni
//! otoritede her zaman bulunur.

use super::engine::{majority, Effects, Engine, Message, Role, LEADER_SILENCE_MS};
use super::store;

impl Engine {
    pub(super) async fn on_vote_request(
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

    pub(super) async fn on_vote_reply(
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
}
