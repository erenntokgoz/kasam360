//! Eşitleme çalışma döngüsü: motoru tek görevde sürer.
//!
//! Kilit yerine sıra kullanılması, ağ beklerken veritabanı kilidi tutulmasını
//! baştan engeller. Kalp atışı, seçim zamanı, bağlantı arama ve bekleyen
//! işlemlerin zaman aşımı burada yönetilir.

use super::engine::{Effects, Engine, Message, Role, LEASE_MS};
use super::op_log::{lookup, Operation, OperationOutcome, OperationStatus};
use super::pairing::{JoinGrant, JoinRequest};
use super::runtime::{Command, LanSync, MemberStatus, SyncStatus};
use super::secure_channel::DeviceKey;
use super::store;
use super::transport;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

const TICK: Duration = Duration::from_millis(100);
const HEARTBEAT_MS: u64 = 300;
const ELECTION_MIN_MS: u64 = 1_500;
const ELECTION_SPREAD_MS: u64 = 1_500;
const DIAL_EVERY_MS: u64 = 1_000;
const SUBMIT_TIMEOUT_MS: u64 = 5_000;
/// Sonucu doğrulanamayan işlem bu süre sonunda durum çubuğundan düşer; işlem
/// kaydı ve sonuç sorgusu etkilenmez.
const UNRESOLVED_VISIBLE_MS: u64 = 60_000;

fn jitter() -> u64 {
    let mut bytes = [0u8; 2];
    let filled = ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes);
    let value = filled.map_or(0, |()| u64::from(u16::from_be_bytes(bytes)));
    ELECTION_MIN_MS + value % ELECTION_SPREAD_MS
}

/// Otoriteye ulaşılamayınca işlem kuyruğa alınmaz: kullanıcı beklemez, bilir.
const NO_AUTHORITY: &str = "NO_CONNECTION: işlem otoritesine ulaşılamıyor";

struct Waiter {
    reply: oneshot::Sender<Result<OperationOutcome, String>>,
    deadline: u64,
}

struct PeerLink {
    connection: u64,
    outgoing: mpsc::Sender<Message>,
}

pub(super) struct Actor {
    sync: LanSync,
    engine: Engine,
    key: Arc<DeviceKey>,
    me: String,
    listen_port: u16,
    sender: mpsc::Sender<Command>,
    peers: BTreeMap<String, PeerLink>,
    dialing: BTreeSet<String>,
    waiters: HashMap<String, Waiter>,
    unresolved: BTreeMap<String, u64>,
    clock: Instant,
    election_deadline: u64,
    last_heartbeat: u64,
    last_dial: u64,
}

impl Actor {
    pub(super) fn new(
        sync: LanSync,
        engine: Engine,
        key: Arc<DeviceKey>,
        me: String,
        listen_port: u16,
        sender: mpsc::Sender<Command>,
    ) -> Self {
        Self {
            sync,
            engine,
            key,
            me,
            listen_port,
            sender,
            peers: BTreeMap::new(),
            dialing: BTreeSet::new(),
            waiters: HashMap::new(),
            unresolved: BTreeMap::new(),
            clock: Instant::now(),
            election_deadline: 0,
            last_heartbeat: 0,
            last_dial: 0,
        }
    }

    fn now(&self) -> u64 {
        u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    pub(super) async fn run(mut self, mut commands: mpsc::Receiver<Command>) {
        // Çalışma yeniden başlayınca takipçi kısa süre otoriteyi bekler.
        self.election_deadline = self.now() + jitter();
        if self.engine.members().await.is_ok_and(|m| m.len() == 1) {
            self.election_deadline = 0;
        }
        let mut ticker = tokio::time::interval(TICK);
        loop {
            let outcome = tokio::select! {
                command = commands.recv() => match command {
                    Some(command) => self.on_command(command).await,
                    None => break,
                },
                _ = ticker.tick() => self.on_tick().await,
            };
            if let Err(reason) = outcome {
                tracing::error!("Eşitleme döngüsü hatası: {reason}");
            }
            if self.sync.inner.commands.lock().await.is_none() {
                break;
            }
        }
    }

    fn dispatch(&mut self, effects: Effects) {
        for (to, message) in effects.send {
            if let Some(peer) = self.peers.get(&to) {
                // Dolu kuyruk kopuk bağlantı gibidir; kalp atışı yeniden gönderir.
                let _ = peer.outgoing.try_send(message);
            }
        }
        for outcome in effects.applied {
            self.unresolved.remove(&outcome.operation_id);
            if let Some(waiter) = self.waiters.remove(&outcome.operation_id) {
                let _ = waiter.reply.send(Ok(outcome));
            }
        }
        for (operation_id, error) in effects.rejected {
            if let Some(waiter) = self.waiters.remove(&operation_id) {
                let _ = waiter.reply.send(Err(error));
            }
        }
    }

    async fn on_command(&mut self, command: Command) -> Result<(), String> {
        let now = self.now();
        match command {
            Command::Submit { operation, reply } => {
                self.on_submit(*operation, reply, now).await;
            }
            Command::Join {
                request,
                address,
                reply,
            } => {
                let answer = self.on_join(request, address, now).await;
                let _ = reply.send(answer);
            }
            Command::Inbound { from, message } => {
                let before = self.engine.last_leader_contact;
                let effects = self.engine.handle(&from, message, now).await?;
                if self.engine.last_leader_contact != before {
                    self.election_deadline = now + jitter();
                }
                self.dispatch(effects);
            }
            Command::PeerUp {
                id,
                connection,
                outgoing,
                initiated_here,
            } => {
                self.dialing.remove(&id);
                // İki taraf aynı anda bağlanırsa ikisi de düşük kimliğin açtığını tutar.
                let prefer_new = (self.me < id) == initiated_here;
                if prefer_new || !self.peers.contains_key(&id) {
                    self.peers.insert(
                        id,
                        PeerLink {
                            connection,
                            outgoing,
                        },
                    );
                }
            }
            Command::PeerDown { id, connection } => {
                if self
                    .peers
                    .get(&id)
                    .is_some_and(|p| p.connection == connection)
                {
                    self.peers.remove(&id);
                }
            }
            Command::DialFailed { id } => {
                self.dialing.remove(&id);
            }
        }
        Ok(())
    }

    async fn on_submit(
        &mut self,
        operation: Operation,
        reply: oneshot::Sender<Result<OperationOutcome, String>>,
        now: u64,
    ) {
        let operation_id = operation.operation_id.clone();
        // Sonuçlanmış işlem otoriteye gitmeden yanıtlanır: tekrar aynı sonucu alır.
        let known = match self.sync.inner.pool.acquire().await {
            Ok(mut conn) => {
                lookup(
                    &mut conn,
                    &operation.tenant_id,
                    &operation_id,
                    Some(&operation.intent_sha256),
                )
                .await
            }
            Err(error) => Err(error.to_string()),
        };
        match known {
            Ok(Some(outcome)) if outcome.status != OperationStatus::Pending => {
                let _ = reply.send(Ok(outcome));
                return;
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
            Ok(_) => {}
        }
        let waiter = Waiter {
            reply,
            deadline: now + SUBMIT_TIMEOUT_MS,
        };
        if self.engine.role == Role::Leader {
            self.waiters.insert(operation_id.clone(), waiter);
            match self.engine.propose(&operation, now).await {
                Ok(effects) => self.dispatch(effects),
                Err(error) => {
                    if let Some(waiter) = self.waiters.remove(&operation_id) {
                        let _ = waiter.reply.send(Err(error));
                    }
                }
            }
            return;
        }
        let link = self
            .engine
            .leader_id
            .as_ref()
            .and_then(|leader| self.peers.get(leader));
        match link {
            Some(link)
                if link
                    .outgoing
                    .try_send(Message::Forward {
                        operation: Box::new(operation.clone()),
                    })
                    .is_ok() =>
            {
                self.waiters.insert(operation_id, waiter);
            }
            _ => {
                let _ = waiter.reply.send(Err(NO_AUTHORITY.to_string()));
            }
        }
    }

    async fn on_join(
        &mut self,
        request: JoinRequest,
        address: String,
        now: u64,
    ) -> Result<JoinGrant, String> {
        if self.engine.role != Role::Leader || !self.engine.has_quorum(now).await? {
            return Err("CONFLICT: eşleştirme otorite cihazdan yapılır".to_string());
        }
        let (grant, effects) = self.engine.admit(&request, &address, now).await?;
        self.dispatch(effects);
        Ok(grant)
    }

    async fn on_tick(&mut self) -> Result<(), String> {
        let now = self.now();
        self.unresolved
            .retain(|_, visible_until| *visible_until > now);
        let expired: Vec<String> = self
            .waiters
            .iter()
            .filter(|(_, waiter)| waiter.deadline <= now)
            .map(|(id, _)| id.clone())
            .collect();
        for operation_id in expired {
            if let Some(waiter) = self.waiters.remove(&operation_id) {
                self.unresolved
                    .insert(operation_id.clone(), now + UNRESOLVED_VISIBLE_MS);
                let _ = waiter.reply.send(Ok(OperationOutcome {
                    status: OperationStatus::Pending,
                    ..OperationOutcome::unknown(&operation_id)
                }));
            }
        }
        if self.engine.role != Role::Leader && now >= self.election_deadline {
            self.election_deadline = now + jitter();
            let effects = self.engine.on_election_timeout(now).await?;
            self.dispatch(effects);
        }
        if now.saturating_sub(self.last_heartbeat) >= HEARTBEAT_MS {
            self.last_heartbeat = now;
            let effects = self.engine.on_heartbeat().await?;
            self.dispatch(effects);
            self.publish(now).await?;
        }
        if now.saturating_sub(self.last_dial) >= DIAL_EVERY_MS {
            self.last_dial = now;
            self.dial_missing().await?;
        }
        Ok(())
    }

    async fn dial_missing(&mut self) -> Result<(), String> {
        let members = self.engine.members().await?;
        // Üyelikten çıkan cihazın açık bağlantısı da kapanır.
        self.peers
            .retain(|id, _| members.iter().any(|member| &member.device_id == id));
        for member in members {
            let id = member.device_id;
            if id == self.me || self.peers.contains_key(&id) || self.dialing.contains(&id) {
                continue;
            }
            let known: Option<String> =
                sqlx::query_scalar("SELECT address FROM sync_peers WHERE device_id = ?")
                    .bind(&id)
                    .fetch_optional(&self.sync.inner.pool)
                    .await
                    .map_err(|e| e.to_string())?;
            let address = known.unwrap_or(member.address);
            if address.is_empty() {
                continue;
            }
            self.dialing.insert(id.clone());
            transport::spawn_dial(
                address,
                id,
                self.sync.inner.pool.clone(),
                self.key.clone(),
                self.me.clone(),
                self.listen_port,
                self.sender.clone(),
            );
        }
        Ok(())
    }

    async fn publish(&self, now: u64) -> Result<(), String> {
        let row = self.engine.cluster().await?;
        let members = self.engine.members().await?;
        let (last_index, _) = {
            let mut conn = self
                .sync
                .inner
                .pool
                .acquire()
                .await
                .map_err(|e| e.to_string())?;
            store::last_position(&mut conn, &row).await?
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
                member.device_id != self.me
                    && self.engine.match_index.get(&member.device_id).copied() != Some(last_index)
            });
        let state = if self.engine.halted.is_some() {
            "INTERVENTION"
        } else if !self.unresolved.is_empty() {
            "VERIFYING"
        } else if !authority_alive {
            "NO_CONNECTION"
        } else if behind {
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
