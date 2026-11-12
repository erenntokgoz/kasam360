//! Bulut eşitleme istemcisi (`docs/cloud-sync.md`).
//!
//! Asıl kayıt buluttaki MongoDB işletme kümesindedir; kasa önce yerele yazar, satış internetsiz
//! durmaz. Arka plandaki görev günlüğü (`sync_operations`) sırayla buluta gönderir,
//! diğer kasaların işlemlerini çeker ve hesaptan çıkışta bulutun onayıyla yerel
//! veriyi siler. Ağ hatası yeniden denenir; kimlik reddinde ve kalıcı hatada görev
//! durur ve durumu yayınlar, hiçbir hata sessizce yutulmaz.

pub mod api;
pub mod baseline;
pub mod inbox;
pub mod merge_wire;
pub mod outbox;
pub mod restore;
pub mod state;
pub mod wipe;
pub mod wire;
mod worker;

#[cfg(test)]
mod fake_api;
#[cfg(test)]
mod restore_tests;
#[cfg(test)]
mod sync_tests;

use api::{CloudApi, Credentials};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use state::Identity;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tokio::sync::Notify;

pub use restore::{RestoreOutcome, RestoreProgress};
pub use wipe::ReleaseOutcome;

/// Yazma yollarının göndericiyi hemen uyandırması için. Çağrılmasa da gönderici
/// birkaç saniyede bir günlüğe bakar; uyandırma yalnız gecikmeyi kısaltır.
static WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);

pub fn notify_write() {
    WAKE.notify_one();
}

#[derive(Debug, Clone, PartialEq)]
pub enum SyncError {
    /// Ağ veya sunucu geçici hatası: geri çekilerek yeniden denenir.
    Transient(String),
    /// Yerel veritabanı hatası: yeniden denenir, ekranda görünür.
    Local(String),
    /// Kimlik veya lisans reddi (401/403): anahtar değişene kadar istek atılmaz.
    Halted { code: String, message: String },
    /// Aynı istekle düzelmeyecek hata (ör. `OPERATION_CONFLICT`).
    Permanent { code: String, message: String },
}

impl SyncError {
    pub fn code(&self) -> &str {
        match self {
            Self::Transient(_) => "NETWORK",
            Self::Local(_) => "LOCAL",
            Self::Halted { code, .. } | Self::Permanent { code, .. } => code,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::Transient(message) | Self::Local(message) => message,
            Self::Halted { message, .. } | Self::Permanent { message, .. } => message,
        }
    }
}

/// Ekranın okuduğu durum.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatus {
    /// `DISABLED`, `IDLE`, `SYNCING`, `OFFLINE`, `HALTED` veya `ERROR`.
    pub state: String,
    pub pending: i64,
    pub reviews: Vec<state::CloudReview>,
    pub last_push_at: Option<String>,
    pub last_pull_at: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
    pub wipe_pending: bool,
}

type Publisher = Box<dyn Fn(&CloudSyncStatus) + Send + Sync>;

/// Cihazı lisans/işletme kaydına yeniden bağlayan çağrı (sunucuda işletme ve sahiplik kaydı açılır).
type Relinker =
    Arc<dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + Sync>;

/// Sunucu işletmeyi bulamadığında (404) yeniden bağlama en çok bu aralıkla denenir; aksi halde
/// her turda etkinleştirme isteği sunucuyu yorar.
const RELINK_EVERY: std::time::Duration = std::time::Duration::from_secs(300);

struct Live {
    state: &'static str,
    error_code: Option<String>,
    error: Option<String>,
    /// Reddedilen anahtarın özeti; aynı anahtarla yeniden istek atılmaz.
    halted_key: Option<String>,
}

struct Inner {
    pool: SqlitePool,
    audit_mutex: Arc<tokio::sync::Mutex<()>>,
    wake: Notify,
    live: std::sync::Mutex<Live>,
    publisher: std::sync::Mutex<Option<Publisher>>,
    relinker: std::sync::Mutex<Option<Relinker>>,
    last_relink: std::sync::Mutex<Option<std::time::Instant>>,
    running: AtomicBool,
    /// Gönderim, çekme ve çıkış aynı anda çalışmaz: imleç ve silme tek sırayla ilerler.
    pass_lock: tokio::sync::Mutex<()>,
}

#[derive(Clone)]
pub struct CloudSync {
    inner: Arc<Inner>,
}

/// Bir turun özeti.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PassReport {
    pub enabled: bool,
    pub pushed: usize,
    pub pulled: Option<usize>,
    pub wiped: bool,
}

fn key_digest(credentials: &Credentials) -> String {
    hex::encode(Sha256::digest(credentials.license_key.as_bytes()))
}

impl CloudSync {
    pub fn new(pool: SqlitePool, audit_mutex: Arc<tokio::sync::Mutex<()>>) -> Self {
        Self {
            inner: Arc::new(Inner {
                pool,
                audit_mutex,
                wake: Notify::new(),
                live: std::sync::Mutex::new(Live {
                    state: "IDLE",
                    error_code: None,
                    error: None,
                    halted_key: None,
                }),
                publisher: std::sync::Mutex::new(None),
                relinker: std::sync::Mutex::new(None),
                last_relink: std::sync::Mutex::new(None),
                running: AtomicBool::new(false),
                pass_lock: tokio::sync::Mutex::new(()),
            }),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.inner.pool
    }

    pub fn audit_mutex(&self) -> &Arc<tokio::sync::Mutex<()>> {
        &self.inner.audit_mutex
    }

    /// Durum değişince çağrılır (ör. Tauri olayı).
    pub fn set_publisher(&self, publisher: Publisher) {
        if let Ok(mut slot) = self.inner.publisher.lock() {
            *slot = Some(publisher);
        }
    }

    /// Sunucu işletmeyi bulamazsa cihazı yeniden bağlayacak çağrı (lisans etkinleştirme).
    pub fn set_relinker<F, Fut>(&self, relink: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        if let Ok(mut slot) = self.inner.relinker.lock() {
            *slot = Some(Arc::new(move || Box::pin(relink())));
        }
    }

    /// Yeniden bağlama denendiyse `true`. Sık deneme sunucuyu yormasın diye aralık sınırlıdır.
    async fn try_relink(&self) -> bool {
        let relink = match self.inner.relinker.lock() {
            Ok(slot) => slot.clone(),
            Err(_) => None,
        };
        let Some(relink) = relink else {
            return false;
        };
        let due = match self.inner.last_relink.lock() {
            Ok(mut last) => {
                let due = last.is_none_or(|at| at.elapsed() >= RELINK_EVERY);
                if due {
                    *last = Some(std::time::Instant::now());
                }
                due
            }
            Err(_) => false,
        };
        if due {
            relink().await;
        }
        due
    }

    /// Göndericiyi hemen uyandırır; reddedilmiş anahtar beklemesini de kaldırır.
    pub fn nudge(&self) {
        if let Ok(mut live) = self.inner.live.lock() {
            live.halted_key = None;
        }
        self.inner.wake.notify_one();
    }

    /// Arka plan görevini bir kez başlatır.
    pub fn start(&self, base_url: &str) {
        if self.inner.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let sync = self.clone();
        match api::HttpApi::new(base_url) {
            Ok(http) => {
                tauri::async_runtime::spawn(async move { worker::run(sync, http).await });
            }
            Err(reason) => {
                tracing::error!("Bulut eşitlemesi başlatılamadı: {reason}");
                self.set_live("ERROR", Some("LOCAL"), Some(&reason));
            }
        }
    }

    fn set_live(&self, state: &'static str, code: Option<&str>, error: Option<&str>) {
        if let Ok(mut live) = self.inner.live.lock() {
            live.state = state;
            live.error_code = code.map(str::to_string);
            live.error = error.map(str::to_string);
        }
    }

    async fn publish(&self) {
        let Ok(status) = self.status().await else {
            return;
        };
        if let Ok(publisher) = self.inner.publisher.lock() {
            if let Some(publisher) = publisher.as_ref() {
                publisher(&status);
            }
        }
    }

    /// Bekleyen sayısı diskten okunur; bellekteki durum yalnız son turun sonucudur.
    pub async fn status(&self) -> Result<CloudSyncStatus, String> {
        let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
        let stored = state::load(&mut conn).await?;
        let identity = state::identity(&mut conn).await?;
        let pending = match &identity {
            Some(identity) => state::pending_count(&mut conn, identity).await?,
            None => 0,
        };
        let reviews = match &identity {
            Some(identity) => state::reviews(&mut conn, identity).await?,
            None => Vec::new(),
        };
        let enabled = state::credentials(&mut conn).await?.is_some();
        let (live_state, code, error) = match self.inner.live.lock() {
            Ok(live) => (live.state, live.error_code.clone(), live.error.clone()),
            Err(_) => ("ERROR", Some("LOCAL".to_string()), None),
        };
        Ok(CloudSyncStatus {
            state: if enabled { live_state } else { "DISABLED" }.to_string(),
            pending,
            reviews,
            last_push_at: stored.last_push_at,
            last_pull_at: stored.last_pull_at,
            error_code: code.or(stored.last_error_code),
            error: error.or(stored.last_error),
            wipe_pending: stored.wipe_pending,
        })
    }

    /// Kurulmuş ama hiç yazmamış kasanın cihaz kimliği açılır; ilk yükleme ona bağlanır.
    async fn identity(&self) -> Result<Option<Identity>, SyncError> {
        let local = |e: String| SyncError::Local(e);
        let mut tx = self
            .inner
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| SyncError::Local(e.to_string()))?;
        if let Some(identity) = state::identity(&mut tx).await.map_err(local)? {
            return Ok(Some(identity));
        }
        let Some(tenant_id) = state::setup_tenant(&mut tx).await.map_err(local)? else {
            return Ok(None);
        };
        crate::services::device_identity::ensure_local_device(&mut tx, &tenant_id)
            .await
            .map_err(local)?;
        crate::services::lan_sync::local_log::flush(&mut tx)
            .await
            .map_err(local)?;
        let identity = state::identity(&mut tx).await.map_err(local)?;
        tx.commit()
            .await
            .map_err(|e| SyncError::Local(e.to_string()))?;
        Ok(identity)
    }

    async fn credentials(&self) -> Result<Option<Credentials>, SyncError> {
        let mut conn = self
            .inner
            .pool
            .acquire()
            .await
            .map_err(|e| SyncError::Local(e.to_string()))?;
        state::credentials(&mut conn)
            .await
            .map_err(SyncError::Local)
    }

    async fn push_inner<A: CloudApi>(
        &self,
        api: &A,
        credentials: &Credentials,
        identity: &Identity,
    ) -> Result<usize, SyncError> {
        let baseline_done = {
            let mut conn = self
                .inner
                .pool
                .acquire()
                .await
                .map_err(|e| SyncError::Local(e.to_string()))?;
            state::load(&mut conn)
                .await
                .map_err(SyncError::Local)?
                .baseline_done
        };
        if !baseline_done {
            baseline::ensure(&self.inner.pool, identity)
                .await
                .map_err(SyncError::Local)?;
        }
        outbox::push_all(&self.inner.pool, api, credentials, identity).await
    }

    /// Bir tur: gönder, bekleyen silme varsa tamamla, istenirse çek.
    pub async fn sync_once<A: CloudApi>(
        &self,
        api: &A,
        pull: bool,
    ) -> Result<PassReport, SyncError> {
        let _pass = self.inner.pass_lock.lock().await;
        let mut report = PassReport::default();
        let Some(credentials) = self.credentials().await? else {
            return Ok(report);
        };
        let digest = key_digest(&credentials);
        let halted = self
            .inner
            .live
            .lock()
            .map(|live| live.halted_key.as_deref() == Some(digest.as_str()))
            .unwrap_or(false);
        if halted {
            return Err(SyncError::Halted {
                code: "HALTED".to_string(),
                message: "Bulut bu lisans anahtarını reddetti.".to_string(),
            });
        }
        let Some(identity) = self.identity().await? else {
            return Ok(report);
        };
        if identity.tenant_id != credentials.tenant_id {
            return Err(SyncError::Local(
                "TENANT_MISMATCH: lisans ve yerel kuyruk farklı işletmeye ait".to_string(),
            ));
        }
        report.enabled = true;
        let mut result = self
            .run_pass(api, &credentials, &identity, pull, &mut report)
            .await;
        // 404: bu cihazın işletmesi sunucuda bu anahtarın sahibine bağlı görünmüyor. Etkinleştirme
        // işletmeyi ve sahipliği yoksa açar; sonra tur bir kez daha denenir. Hâlâ 404 ise işletme
        // başka bir hesabındır ve hata sessiz kalmaz: açık kodla durur.
        if matches!(&result, Err(SyncError::Permanent { code, .. }) if code == "NOT_FOUND")
            && self.try_relink().await
        {
            let again = self.credentials().await?;
            if let Some(fresh) = again {
                result = self
                    .run_pass(api, &fresh, &identity, pull, &mut report)
                    .await;
            }
        }
        if let Err(SyncError::Permanent { code, .. }) = &result {
            if code == "NOT_FOUND" {
                result = Err(SyncError::Permanent {
                    code: "TENANT_NOT_OWNED".to_string(),
                    message: "Bu kasadaki işletme, bağlı hesabın işletmesi olarak görünmüyor. İşletmenin sahibi hesabıyla yeniden bağlayın.".to_string(),
                });
            }
        }
        if let Err(SyncError::Halted { .. }) = &result {
            if let Ok(mut live) = self.inner.live.lock() {
                live.halted_key = Some(digest);
            }
        }
        result.map(|()| report)
    }

    async fn run_pass<A: CloudApi>(
        &self,
        api: &A,
        credentials: &Credentials,
        identity: &Identity,
        pull: bool,
        report: &mut PassReport,
    ) -> Result<(), SyncError> {
        report.pushed = self.push_inner(api, credentials, identity).await?;
        let stored = {
            let mut conn = self
                .inner
                .pool
                .acquire()
                .await
                .map_err(|e| SyncError::Local(e.to_string()))?;
            state::load(&mut conn).await.map_err(SyncError::Local)?
        };
        if stored.wipe_pending {
            let outcome = self.finish_wipe(api, credentials, identity).await?;
            report.wiped = outcome.wiped;
            return Ok(());
        }
        if pull {
            let page = inbox::pull_all(
                &self.inner.pool,
                &self.inner.audit_mutex,
                api,
                credentials,
                identity,
            )
            .await?;
            report.pulled = Some(page.applied);
        }
        Ok(())
    }

    /// Hesaba yeniden girilmişse silme iptal edilir; değilse bulut onayıyla silinir.
    async fn finish_wipe<A: CloudApi>(
        &self,
        api: &A,
        credentials: &Credentials,
        identity: &Identity,
    ) -> Result<ReleaseOutcome, SyncError> {
        let local = |e: String| SyncError::Local(e);
        let mut conn = self
            .inner
            .pool
            .acquire()
            .await
            .map_err(|e| SyncError::Local(e.to_string()))?;
        if crate::services::device_session::load(&mut conn)
            .await
            .map_err(local)?
            .signed_in
        {
            state::set_wipe_pending(&mut conn, false)
                .await
                .map_err(local)?;
            return Ok(ReleaseOutcome {
                wiped: false,
                pending: 0,
                code: Some("WIPE_CANCELLED".to_string()),
            });
        }
        drop(conn);
        wipe::release_and_wipe(&self.inner.pool, api, credentials, identity).await
    }

    /// Hesaptan çıkış: silme işaretlenir, bekleyenler gönderilir, bulut onaylarsa silinir.
    /// Ağ yoksa veya onay gelmezse veri kalır; işaret sonraki turda silmeyi tamamlar.
    pub async fn sign_out<A: CloudApi>(&self, api: &A) -> Result<ReleaseOutcome, String> {
        {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            state::set_wipe_pending(&mut conn, true).await?;
        }
        let outcome = match self.sync_once(api, false).await {
            Ok(report) if report.wiped => ReleaseOutcome {
                wiped: true,
                pending: 0,
                code: None,
            },
            // Arka plan turu silmeyi az önce tamamlamış olabilir: kurulum başa dönmüştür.
            Ok(report) if !report.enabled => ReleaseOutcome {
                wiped: self.is_wiped().await?,
                pending: 0,
                code: Some("CLOUD_DISABLED".to_string()),
            },
            Ok(_) => {
                let status = self.status().await?;
                ReleaseOutcome {
                    wiped: false,
                    pending: status.pending,
                    code: Some("PENDING_OPERATIONS".to_string()),
                }
            }
            Err(error) => {
                self.record(&error).await;
                let status = self.status().await?;
                ReleaseOutcome {
                    wiped: false,
                    pending: status.pending,
                    code: Some(error.code().to_string()),
                }
            }
        };
        self.publish().await;
        Ok(outcome)
    }

    async fn is_wiped(&self) -> Result<bool, String> {
        let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
        let pending = state::load(&mut conn).await?.wipe_pending;
        let status = crate::services::setup::load_state(&mut conn).await?.status;
        Ok(!pending && status == "PENDING")
    }

    /// Kalıcı hata ve kimlik reddi diske yazılır; ağ hatası yalnız bellekte durur.
    async fn record(&self, error: &SyncError) {
        let state = match error {
            SyncError::Transient(_) => "OFFLINE",
            SyncError::Halted { .. } => "HALTED",
            SyncError::Local(_) | SyncError::Permanent { .. } => "ERROR",
        };
        self.set_live(state, Some(error.code()), Some(error.message()));
        if matches!(
            error,
            SyncError::Halted { .. } | SyncError::Permanent { .. }
        ) {
            if let Ok(mut conn) = self.inner.pool.acquire().await {
                if let Err(reason) =
                    state::record_error(&mut conn, Some(error.code()), Some(error.message())).await
                {
                    tracing::error!("Bulut hatası kaydedilemedi: {reason}");
                }
            }
        }
        tracing::warn!("Bulut eşitlemesi: {} {}", error.code(), error.message());
    }

    /// Henüz kurulmamış kasayı hesap sahibinin seçtiği işletmenin bulut verisiyle doldurur.
    /// Kimlik bilgisi kurulum kaydından değil, az önce o işletmeye bağlanan lisanstan gelir;
    /// boş kasa şartı ve sayfa/işletme eşleşmesi `restore::restore` içinde korunur.
    pub async fn restore_tenant<A: CloudApi>(
        &self,
        api: &A,
        credentials: &Credentials,
        email: Option<&str>,
        progress: &(dyn Fn(RestoreProgress) + Send + Sync),
    ) -> Result<RestoreOutcome, SyncError> {
        let _pass = self.inner.pass_lock.lock().await;
        let outcome = restore::restore(
            &self.inner.pool,
            &self.inner.audit_mutex,
            api,
            credentials,
            email,
            progress,
        )
        .await?;
        self.nudge();
        Ok(outcome)
    }

    /// Geri yükleme: boş kasaya bulut verisi indirilir, ardından gönderici uyandırılır.
    pub async fn restore<A: CloudApi>(
        &self,
        api: &A,
        email: Option<&str>,
        progress: &(dyn Fn(RestoreProgress) + Send + Sync),
    ) -> Result<RestoreOutcome, SyncError> {
        let _pass = self.inner.pass_lock.lock().await;
        let credentials = self.credentials().await?.ok_or_else(|| SyncError::Halted {
            code: "NO_LICENSE_KEY".to_string(),
            message: "Cihaz işletme hesabına bağlı değil.".to_string(),
        })?;
        let tenant_id = {
            let mut conn = self
                .inner
                .pool
                .acquire()
                .await
                .map_err(|error| SyncError::Local(error.to_string()))?;
            state::setup_tenant(&mut conn)
                .await
                .map_err(SyncError::Local)?
        };
        if tenant_id.as_deref() != Some(credentials.tenant_id.as_str()) {
            return Err(SyncError::Local(
                "TENANT_MISMATCH: lisans ve kurulum farklı işletmeye ait".to_string(),
            ));
        }
        let outcome = restore::restore(
            &self.inner.pool,
            &self.inner.audit_mutex,
            api,
            &credentials,
            email,
            progress,
        )
        .await?;
        self.nudge();
        Ok(outcome)
    }
}
