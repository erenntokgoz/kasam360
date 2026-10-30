//! Eşitleme çalışma döngüsü ve uygulamaya açılan yüz.
//!
//! Motor tek görevde çalışır; komutlar kuyrukla gelir. Kilit yerine sıra
//! kullanılması, ağ beklerken veritabanı kilidi tutulmasını baştan engeller.

use super::engine::{Effects, Engine, Message, Role, LEASE_MS};
use super::op_log::{lookup, LogOp, Operation, OperationOutcome, OperationStatus};
use super::pairing::{self, JoinGrant, JoinRequest, PairingCode};
use super::secure_channel::DeviceKey;
use super::store::{self, Member};
use super::transport;
use crate::services::cari::CariOp;
use crate::services::device_identity::ensure_local_device;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, Mutex};

pub const DEFAULT_PORT: u16 = 47360;
const TICK: Duration = Duration::from_millis(100);
const HEARTBEAT_MS: u64 = 300;
const ELECTION_MIN_MS: u64 = 1_500;
const ELECTION_SPREAD_MS: u64 = 1_500;
const DIAL_EVERY_MS: u64 = 1_000;
const SUBMIT_TIMEOUT_MS: u64 = 5_000;

pub enum Command {
    Submit {
        operation: Box<Operation>,
        reply: oneshot::Sender<Result<OperationOutcome, String>>,
    },
    Join {
        request: JoinRequest,
        address: String,
        reply: oneshot::Sender<Result<JoinGrant, String>>,
    },
    Inbound {
        from: String,
        message: Message,
    },
    PeerUp {
        id: String,
        connection: u64,
        outgoing: mpsc::Sender<Message>,
        initiated_here: bool,
    },
    PeerDown {
        id: String,
        connection: u64,
    },
    DialFailed {
        id: String,
    },
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberStatus {
    pub device_id: String,
    pub name: String,
    pub connected: bool,
    pub is_authority: bool,
    pub is_local: bool,
    /// Bu cihazın bildiği, üyenin onayladığı son günlük konumu.
    pub acknowledged_index: Option<i64>,
    pub last_seen: Option<String>,
}

/// Arayüzdeki durum sözleşmesi (`docs/local-network-sync.md`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// `SINGLE`: eşleştirilmemiş kurulum, `CLUSTER`: eşleştirilmiş.
    pub mode: &'static str,
    /// `READY`, `SYNCING`, `NO_CONNECTION`, `VERIFYING`, `INTERVENTION`.
    pub state: &'static str,
    pub role: Option<Role>,
    pub term: i64,
    pub commit_index: i64,
    pub detail: Option<String>,
    pub members: Vec<MemberStatus>,
}

impl SyncStatus {
    fn single() -> Self {
        Self {
            mode: "SINGLE",
            state: "READY",
            role: None,
            term: 0,
            commit_index: 0,
            detail: None,
            members: Vec::new(),
        }
    }
}

struct Inner {
    pool: SqlitePool,
    audit: Arc<Mutex<()>>,
    bind_host: String,
    status: RwLock<SyncStatus>,
    commands: Mutex<Option<mpsc::Sender<Command>>>,
    listener: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Uygulama durumundaki paylaşılan eşitleme yüzü.
#[derive(Clone)]
pub struct LanSync {
    inner: Arc<Inner>,
}

fn jitter() -> u64 {
    let mut bytes = [0u8; 2];
    let filled = ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes);
    let value = filled.map_or(0, |()| u64::from(u16::from_be_bytes(bytes)));
    ELECTION_MIN_MS + value % ELECTION_SPREAD_MS
}

impl LanSync {
    pub fn new(pool: SqlitePool, audit: Arc<Mutex<()>>, bind_host: &str) -> Self {
        Self {
            inner: Arc::new(Inner {
                pool,
                audit,
                bind_host: bind_host.to_string(),
                status: RwLock::new(SyncStatus::single()),
                commands: Mutex::new(None),
                listener: Mutex::new(None),
            }),
        }
    }

    pub fn status(&self) -> SyncStatus {
        self.inner
            .status
            .read()
            .map(|status| status.clone())
            .unwrap_or_else(|_| {
                let mut failed = SyncStatus::single();
                failed.state = "INTERVENTION";
                failed
            })
    }

    fn publish(&self, status: SyncStatus) {
        if let Ok(mut current) = self.inner.status.write() {
            *current = status;
        }
    }

    /// Birden çok cihaz bağlı mı? Tek üyeli küme tek cihaz gibi davranır.
    pub fn is_multi_device(&self) -> bool {
        self.status().members.len() > 1
    }

    /// Henüz günlüğe taşınmamış finansal yazmaların kapısı.
    ///
    /// Bu yazmalar diğer cihazlara ulaşmaz. Çok cihazlı kurulumda kabul edilirse
    /// cihaz kaybında onaylanmış işlem kaybolur; bu yüzden tümü durur.
    pub fn require_local_write(&self) -> Result<(), String> {
        let status = self.status();
        if status.members.len() <= 1 {
            return Ok(());
        }
        if status.state == "NO_CONNECTION" || status.state == "INTERVENTION" {
            return Err("QUORUM_LOST: çoğunluk yok; finansal yazma durduruldu".to_string());
        }
        Err(
            "SYNC_UNSUPPORTED: bu işlem çok cihazlı eşitlemeye henüz taşınmadı; \
             cihazı pasife almadan kullanılamaz"
                .to_string(),
        )
    }

    /// Küme kullanımındaki cari işlemin taşınabilir olduğunu doğrular.
    pub fn require_replicable(&self, op: &CariOp) -> Result<(), String> {
        if !self.is_multi_device() {
            return Ok(());
        }
        match op {
            // Kasa vardiyası ve mal kabulü henüz eşitlenmez; diğer cihazda
            // uygulanamayan işlem günlüğe girerse cihazlar ayrışır.
            CariOp::RecordPayment(input) if input.payment_method == "CASH" => Err(
                "SYNC_UNSUPPORTED: nakit cari hareketi vardiya eşitlemesi gelene kadar kapalı"
                    .to_string(),
            ),
            CariOp::ApproveDocument(_) => {
                Err("SYNC_UNSUPPORTED: belge onayı stok eşitlemesi gelene kadar kapalı".to_string())
            }
            _ => Ok(()),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.commands.lock().await.is_some()
    }

    /// Uygulama açılışı: kayıtlı küme varsa döngüyü başlatır.
    pub async fn resume(&self) -> Result<(), String> {
        let row = {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            store::load_cluster(&mut conn).await?
        };
        match row {
            Some(row) => self.start(row.listen_port).await.map(|_| ()),
            None => Ok(()),
        }
    }

    async fn start(&self, port: u16) -> Result<u16, String> {
        let listener = TcpListener::bind((self.inner.bind_host.as_str(), port))
            .await
            .map_err(|e| format!("Eşitleme portu açılamadı: {e}"))?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        self.start_with(listener).await?;
        Ok(bound)
    }

    async fn start_with(&self, listener: TcpListener) -> Result<(), String> {
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
        let key = Arc::new(DeviceKey::load_or_create(&mut conn).await?);
        let row = store::load_cluster(&mut conn)
            .await?
            .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
        let me = ensure_local_device(&mut conn, &row.tenant_id).await?;
        sqlx::query("UPDATE sync_cluster SET listen_port = ? WHERE slot = 1")
            .bind(i64::from(bound))
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        drop(conn);
        let engine = Engine::open(
            self.inner.pool.clone(),
            self.inner.audit.clone(),
            me.clone(),
        )
        .await?
        .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
        // Kapı ilk kalp atışını beklemez: küme açılır açılmaz doğru durum görünür.
        self.publish(SyncStatus {
            mode: "CLUSTER",
            state: "SYNCING",
            role: Some(Role::Follower),
            term: row.term,
            commit_index: row.commit_index,
            detail: None,
            members: engine
                .members()
                .await?
                .into_iter()
                .map(|member| MemberStatus {
                    is_local: member.device_id == me,
                    device_id: member.device_id,
                    name: member.name,
                    ..MemberStatus::default()
                })
                .collect(),
        });
        let (sender, receiver) = mpsc::channel(1024);
        let listen = transport::spawn_listener(
            listener,
            self.inner.pool.clone(),
            key.clone(),
            me.clone(),
            row.tenant_id.clone(),
            sender.clone(),
        );
        *self.inner.commands.lock().await = Some(sender.clone());
        *self.inner.listener.lock().await = Some(listen);
        let actor = Actor {
            sync: self.clone(),
            engine,
            key,
            me,
            listen_port: bound,
            sender,
            peers: BTreeMap::new(),
            dialing: BTreeSet::new(),
            waiters: HashMap::new(),
            unresolved: BTreeSet::new(),
            clock: Instant::now(),
            election_deadline: 0,
            last_heartbeat: 0,
            last_dial: 0,
        };
        tokio::spawn(actor.run(receiver));
        Ok(())
    }

    /// Testlerde cihaz kapanmasını, uygulamada kapanışı temsil eder.
    pub async fn shutdown(&self) {
        *self.inner.commands.lock().await = None;
        if let Some(listener) = self.inner.listener.lock().await.take() {
            listener.abort();
        }
    }

    pub async fn submit(&self, operation: Operation) -> Result<OperationOutcome, String> {
        let sender = self
            .inner
            .commands
            .lock()
            .await
            .clone()
            .ok_or_else(|| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?;
        let (reply, answer) = oneshot::channel();
        sender
            .send(Command::Submit {
                operation: Box::new(operation),
                reply,
            })
            .await
            .map_err(|_| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?;
        answer
            .await
            .map_err(|_| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?
    }

    /// Bu cihazı gerekirse tek üyeli kümeye çevirir ve eşleştirme kodu üretir.
    pub async fn create_pairing_code(
        &self,
        tenant_id: &str,
        device_name: &str,
        host: &str,
        port: u16,
    ) -> Result<(String, String), String> {
        let pool = &self.inner.pool;
        if !self.is_running().await {
            let listener = TcpListener::bind((self.inner.bind_host.as_str(), port))
                .await
                .map_err(|e| format!("Eşitleme portu açılamadı: {e}"))?;
            let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
            let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
            let key = DeviceKey::load_or_create(&mut tx).await?;
            pairing::init_cluster(&mut tx, tenant_id, device_name, &key.public_key, bound).await?;
            tx.commit().await.map_err(|e| e.to_string())?;
            self.start_with(listener).await?;
        }
        let port = {
            let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
            store::load_cluster(&mut conn)
                .await?
                .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?
                .listen_port
        };
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let (code, expires_at) =
            pairing::create_code(&mut conn, tenant_id, &format!("{host}:{port}")).await?;
        Ok((code.render(), expires_at))
    }

    /// Boş kurulumu mevcut kümeye katar.
    pub async fn join(
        &self,
        code_text: &str,
        local_tenant: &str,
        device_name: &str,
        port: u16,
    ) -> Result<(), String> {
        if self.is_running().await {
            return Err("CONFLICT: bu cihaz zaten bir kümeye bağlı".to_string());
        }
        let code = PairingCode::parse(code_text)?;
        let pool = &self.inner.pool;
        let listener = TcpListener::bind((self.inner.bind_host.as_str(), port))
            .await
            .map_err(|e| format!("Eşitleme portu açılamadı: {e}"))?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        let (me, public_key) = {
            let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
            let key = DeviceKey::load_or_create(&mut conn).await?;
            (
                ensure_local_device(&mut conn, local_tenant).await?,
                key.public_key,
            )
        };
        let request = JoinRequest {
            device_id: me.clone(),
            name: device_name.to_string(),
            public_key,
            listen_port: bound,
        };
        let grant = transport::request_join(&code, &me, &request).await?;
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        pairing::accept_grant(&mut tx, local_tenant, &grant, bound).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        for member in &grant.base_members {
            if !member.address.is_empty() {
                sqlx::query("INSERT OR REPLACE INTO sync_peers (device_id, address) VALUES (?, ?)")
                    .bind(&member.device_id)
                    .bind(&member.address)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        sqlx::query("INSERT OR REPLACE INTO sync_peers (device_id, address) VALUES (?, ?)")
            .bind(&grant.authority_id)
            .bind(&code.address)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        self.start_with(listener).await
    }

    /// Cihazı planlı olarak üyelikten çıkarır; otorite cihazdan yapılır.
    pub async fn set_device_passive(
        &self,
        tenant_id: &str,
        device_id: &str,
        actor_id: &str,
        actor_role: &str,
    ) -> Result<OperationOutcome, String> {
        let members = {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            let row = store::load_cluster(&mut conn)
                .await?
                .ok_or_else(|| "UNCONFIGURED: bu cihaz eşleştirilmemiş".to_string())?;
            store::current_members(&mut conn, &row).await?
        };
        if !members.iter().any(|member| member.device_id == device_id) {
            return Err("NOT_FOUND: cihaz üyelikte değil".to_string());
        }
        let remaining: Vec<Member> = members
            .into_iter()
            .filter(|member| member.device_id != device_id)
            .collect();
        if remaining.is_empty() {
            return Err("CONFLICT: son cihaz pasife alınamaz".to_string());
        }
        self.submit(Operation {
            operation_id: crate::id_generator::generate_id("op"),
            tenant_id: tenant_id.to_string(),
            device_id: device_id.to_string(),
            actor_id: actor_id.to_string(),
            actor_role: actor_role.to_string(),
            intent_sha256: String::new(),
            op: LogOp::SetMembers(remaining),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
        .await
    }
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

struct Actor {
    sync: LanSync,
    engine: Engine,
    key: Arc<DeviceKey>,
    me: String,
    listen_port: u16,
    sender: mpsc::Sender<Command>,
    peers: BTreeMap<String, PeerLink>,
    dialing: BTreeSet<String>,
    waiters: HashMap<String, Waiter>,
    unresolved: BTreeSet<String>,
    clock: Instant,
    election_deadline: u64,
    last_heartbeat: u64,
    last_dial: u64,
}

impl Actor {
    fn now(&self) -> u64 {
        u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    async fn run(mut self, mut commands: mpsc::Receiver<Command>) {
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
                        operation: operation.clone(),
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
        let expired: Vec<String> = self
            .waiters
            .iter()
            .filter(|(_, waiter)| waiter.deadline <= now)
            .map(|(id, _)| id.clone())
            .collect();
        for operation_id in expired {
            if let Some(waiter) = self.waiters.remove(&operation_id) {
                self.unresolved.insert(operation_id.clone());
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
