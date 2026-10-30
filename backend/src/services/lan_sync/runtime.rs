//! Eşitleme çalışma döngüsü ve uygulamaya açılan yüz.
//!
//! Motor tek görevde çalışır; komutlar kuyrukla gelir. Kilit yerine sıra
//! kullanılması, ağ beklerken veritabanı kilidi tutulmasını baştan engeller.

use super::actor::Actor;
use super::capture;
use super::engine::{Engine, Message, Role};
use super::op_log::{Operation, OperationOutcome};
use super::pairing::{self, JoinGrant, JoinRequest, PairingCode};
use super::secure_channel::DeviceKey;
use super::store;
use super::transport;
use crate::services::device_identity::ensure_local_device;
use serde::Serialize;
use sqlx::SqlitePool;
use std::sync::{Arc, RwLock};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, Mutex};

pub const DEFAULT_PORT: u16 = 47360;

/// Dinlenecek port. Güvenlik duvarı veya aynı makinede ikinci kurulum için
/// `KASAM360_SYNC_PORT` ile değiştirilebilir; geçersiz değer varsayılana düşer.
pub fn sync_port() -> u16 {
    std::env::var("KASAM360_SYNC_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

pub enum Command {
    Submit {
        operation: Box<Operation>,
        reply: oneshot::Sender<Result<OperationOutcome, String>>,
    },
    TakeOver {
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

pub(super) struct Inner {
    pub(super) pool: SqlitePool,
    audit: Arc<Mutex<()>>,
    bind_host: String,
    status: RwLock<SyncStatus>,
    pub(super) commands: Mutex<Option<mpsc::Sender<Command>>>,
    listener: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Uygulama durumundaki paylaşılan eşitleme yüzü.
#[derive(Clone)]
pub struct LanSync {
    pub(super) inner: Arc<Inner>,
}

impl LanSync {
    pub fn new(pool: SqlitePool, audit: Arc<Mutex<()>>, bind_host: &str) -> Self {
        let sync = Self {
            inner: Arc::new(Inner {
                pool: pool.clone(),
                audit,
                bind_host: bind_host.to_string(),
                status: RwLock::new(SyncStatus::single()),
                commands: Mutex::new(None),
                listener: Mutex::new(None),
            }),
        };
        super::write_tx::register(&pool, sync.clone());
        sync
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

    pub(super) fn publish(&self, status: SyncStatus) {
        if let Ok(mut current) = self.inner.status.write() {
            *current = status;
        }
    }

    /// Birden çok cihaz bağlı mı? Tek üyeli küme tek cihaz gibi davranır.
    pub fn is_multi_device(&self) -> bool {
        self.status().members.len() > 1
    }

    /// Yazmalar bu cihazda çoğunluk onayından mı geçer? Üyelikten çıkarılan cihaz da
    /// bu yoldadır: tek başına yazarsa kümeden sessizce ayrışırdı.
    pub fn replicates_writes(&self) -> bool {
        let status = self.status();
        status.mode == "CLUSTER"
            && (status.members.len() > 1 || !status.members.iter().any(|member| member.is_local))
    }

    /// Küme kimliği ve bu cihaz; yazma günlüğe bunlarla girer.
    pub(super) async fn identity(&self) -> Result<(String, String), String> {
        let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
        let row = store::load_cluster(&mut conn)
            .await?
            .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
        let device = ensure_local_device(&mut conn, &row.tenant_id).await?;
        Ok((row.tenant_id, device))
    }

    /// Yazma komutunun erken kapısı: çoğunluk yoksa kullanıcı işlemi boşuna hazırlamaz.
    /// Asıl güvence günlüktür; bu kapı yalnız hızlı ve anlaşılır hata verir.
    pub fn require_local_write(&self) -> Result<(), String> {
        let status = self.status();
        if status.state == "INTERVENTION"
            || (self.replicates_writes() && status.state == "NO_CONNECTION")
        {
            return Err("QUORUM_LOST: çoğunluk yok; finansal yazma durduruldu".to_string());
        }
        Ok(())
    }

    /// IPC kapısı: çok cihazlı modda eşitlenmeyen komutu çalıştırmadan reddeder.
    pub fn gate_command(&self, command: &str) -> Result<(), String> {
        if super::write_gate::allowed_in_cluster(command) {
            return Ok(());
        }
        self.require_local_write()
    }

    pub async fn is_running(&self) -> bool {
        self.inner.commands.lock().await.is_some()
    }

    /// Uygulama açılışı: kayıtlı küme varsa döngüyü başlatır.
    ///
    /// Port açılamazsa uygulama yine başlar ama durum `INTERVENTION` olur ve
    /// finansal yazma kapanır; kayıtlı üyelik sessizce yok sayılmaz.
    pub async fn resume(&self) {
        if let Err(reason) = self.try_resume().await {
            tracing::error!("Eşitleme başlatılamadı: {reason}");
            let mut status = self.status();
            status.mode = "CLUSTER";
            status.state = "INTERVENTION";
            status.detail = Some(reason);
            self.publish(status);
        }
    }

    async fn try_resume(&self) -> Result<(), String> {
        let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
        let Some(row) = store::load_cluster(&mut conn).await? else {
            // Geri yükleme kümeden ayırır; eski tetikleyici yazmaları kilitli bırakmamalı.
            return capture::sync_triggers(&mut conn, false).await;
        };
        let members = store::current_members(&mut conn, &row).await?;
        let me = ensure_local_device(&mut conn, &row.tenant_id).await?;
        let replicated = members.len() > 1 || !members.iter().any(|m| m.device_id == me);
        capture::sync_triggers(&mut conn, replicated).await?;
        drop(conn);
        let mut status = self.status();
        status.mode = "CLUSTER";
        status.state = "SYNCING";
        status.members = members
            .into_iter()
            .map(|member| MemberStatus {
                device_id: member.device_id,
                name: member.name,
                ..MemberStatus::default()
            })
            .collect();
        self.publish(status);
        self.start(row.listen_port).await.map(|_| ())
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
        let actor = Actor::new(self.clone(), engine, key, me, bound, sender);
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
            let mut tx = pool
                .begin_with("BEGIN IMMEDIATE")
                .await
                .map_err(|e| e.to_string())?;
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
        let mut tx = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        pairing::accept_grant(&mut tx, local_tenant, &grant, bound).await?;
        crate::services::setup::mark_joined(&mut tx, &grant.tenant_id).await?;
        capture::sync_triggers(&mut tx, true).await?;
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
}
