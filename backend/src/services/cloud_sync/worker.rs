//! Arka plan döngüsü: sürekli gönderim, periyodik çekme, geri çekilmeli yeniden deneme.
//!
//! Ağ hatasında bekleme 2 saniyeden 60 saniyeye kadar ikiye katlanır; kasanın
//! internetsiz geçen saatleri sunucuyu yormaz, bağlantı gelince en geç bir dakikada
//! gönderim sürer. Yeni yazma (`notify_write`) beklemeyi keser.

use super::api::CloudApi;
use super::{CloudSync, SyncError, WAKE};
use std::time::{Duration, Instant};

const IDLE_TICK: Duration = Duration::from_secs(3);
const PULL_EVERY: Duration = Duration::from_secs(30);
const BACKOFF_START: Duration = Duration::from_secs(2);
const BACKOFF_MAX: Duration = Duration::from_secs(60);
/// Kimlik reddi veya kalıcı hatada aynı istek bu aralıkla yeniden denetlenir.
const STOPPED_TICK: Duration = Duration::from_secs(60);

/// Geri çekilme adımı: her hatada ikiye katlanır, üst sınırda kalır.
pub(super) fn next_backoff(current: Duration) -> Duration {
    (current * 2).min(BACKOFF_MAX)
}

async fn wait(sync: &CloudSync, duration: Duration) {
    tokio::select! {
        _ = sync.inner.wake.notified() => {}
        _ = WAKE.notified() => {}
        _ = tokio::time::sleep(duration) => {}
    }
}

pub(super) async fn run<A: CloudApi>(sync: CloudSync, api: A) {
    let mut backoff = BACKOFF_START;
    let mut last_pull: Option<Instant> = None;
    loop {
        let pull = last_pull.is_none_or(|at| at.elapsed() >= PULL_EVERY);
        sync.set_live("SYNCING", None, None);
        let pause = match sync.sync_once(&api, pull).await {
            Ok(report) => {
                backoff = BACKOFF_START;
                if report.pulled.is_some() {
                    last_pull = Some(Instant::now());
                }
                sync.set_live(if report.enabled { "IDLE" } else { "DISABLED" }, None, None);
                if report.pushed > 0 || report.pulled.is_some_and(|n| n > 0) || report.wiped {
                    sync.publish().await;
                }
                IDLE_TICK
            }
            Err(error) => {
                sync.record(&error).await;
                sync.publish().await;
                match error {
                    SyncError::Transient(_) | SyncError::Local(_) => {
                        let pause = backoff;
                        backoff = next_backoff(backoff);
                        pause
                    }
                    SyncError::Halted { .. } | SyncError::Permanent { .. } => STOPPED_TICK,
                }
            }
        };
        wait(&sync, pause).await;
    }
}
