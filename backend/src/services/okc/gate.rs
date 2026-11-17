//! Tahsilat kapısı: yazar kasa açıkken fiş kesilmeden tahsilat tamamlanmaz.
//!
//! Sıra: ayar kapalıysa hiçbir şey yapılmaz; açıksa daha önce kesilmiş fiş varsa
//! o döner (ikinci fiş yok); değilse cihaza bağlanılıp fiş kesilir. Cihaz hatası
//! tahsilat işlemini geri aldırır, böylece adisyon açık kalır ve kaybolmaz;
//! hata `okc_receipts` içine kalıcı uyarı olarak yazılır.
//!
//! Bağlantı `DeviceConnector` arkasındadır: üretimde `SystemConnector` gerçek
//! cihaza gider, testlerde simülatör bağlanır. Gerçek cihaz yoksa
//! (veya eşleşme yoksa) sonuç her zaman hatadır, asla sahte başarı değildir.

use std::sync::Arc;
use std::time::Duration;

use sqlx::SqliteConnection;

use super::receipt_log;
use super::session::{OkcClient, SoftwareIdentity};
use super::settings::{self, ConnectionKind, OkcSettings};
use super::transport::TcpTransport;
use super::types::{FiscalReceipt, OkcError, OkcResult, ReceiptDraft};
use crate::db::DbPool;
use crate::services::lan_sync::WritePool;

/// Ayara göre eşleşmiş bir istemci üretir. Engelleyici G/Ç yapar; çağıran
/// `spawn_blocking` içinde kullanır.
pub trait DeviceConnector: Send + Sync {
    fn connect(&self, settings: &OkcSettings) -> OkcResult<OkcClient>;
}

pub struct SystemConnector;

#[cfg(any(test, debug_assertions))]
fn simulator_client(settings: &OkcSettings) -> OkcResult<OkcClient> {
    use super::simulator::{
        SimulatedRegister, SimulatorTransport, SimulatorVerifier, SIMULATOR_SERIAL,
    };
    use std::sync::OnceLock;
    // Süreç boyunca tek simülatör: fiş sayaçları ve sepetler çağrılar arasında korunur.
    static REGISTER: OnceLock<SimulatedRegister> = OnceLock::new();
    let register = REGISTER.get_or_init(SimulatedRegister::new).clone();
    let mut client = OkcClient::new(
        Box::new(SimulatorTransport::new(register)),
        SIMULATOR_SERIAL,
        Duration::from_millis(settings.response_timeout_ms.unsigned_abs()),
        SoftwareIdentity::default(),
    );
    client.pair(&SimulatorVerifier)?;
    Ok(client)
}

#[cfg(not(any(test, debug_assertions)))]
fn simulator_client(_: &OkcSettings) -> OkcResult<OkcClient> {
    Err(OkcError::NotConnected(
        "yazar kasa bağlı değil (simülatör bu sürümde yok)".to_string(),
    ))
}

impl DeviceConnector for SystemConnector {
    fn connect(&self, settings: &OkcSettings) -> OkcResult<OkcClient> {
        let timeout = Duration::from_millis(settings.response_timeout_ms.unsigned_abs());
        match settings.connection_kind {
            ConnectionKind::Simulator => simulator_client(settings),
            ConnectionKind::Tcp => {
                let transport = TcpTransport::connect(settings.tcp_address()?, timeout)?;
                let client = OkcClient::new(
                    Box::new(transport),
                    settings.terminal_serial.trim(),
                    timeout,
                    SoftwareIdentity::default(),
                );
                // Eşleşme anahtarları kalıcı saklanmaz: üretici kütüphanesi ve yetkili
                // servis eşleştirmesi olmadan fiş kesilmez (belge §3.3, §5.5).
                client.require_paired_for_gate()?;
                Ok(client)
            }
            ConnectionKind::Serial | ConnectionKind::Usb => Err(OkcError::NotConnected(
                "yazar kasa bağlı değil: seri/USB port sürücüsü bu sürümde bağlı değil".to_string(),
            )),
        }
    }
}

impl OkcClient {
    /// Kapı için eşleşme denetimi; mesajı eşleşme eksikliğini açıkça söyler.
    pub(super) fn require_paired_for_gate(&self) -> OkcResult<()> {
        if self.is_paired() {
            Ok(())
        } else {
            Err(OkcError::NotPaired(
                "eşleşme anahtarı yok; ÖKC üreticisinin yetkili servisi eşleştirmeyi yapmalı"
                    .to_string(),
            ))
        }
    }
}

/// Cihazda fişi keser (engelleyici). Üretimde `spawn_blocking` içinden çağrılır.
pub fn issue_blocking(
    connector: &dyn DeviceConnector,
    settings: &OkcSettings,
    draft: &ReceiptDraft,
) -> OkcResult<FiscalReceipt> {
    let mut client = connector.connect(settings)?;
    client.issue_receipt(draft)
}

fn stored_receipt(row: &receipt_log::ReceiptRow) -> OkcResult<FiscalReceipt> {
    let number = |value: Option<i64>| {
        value
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| OkcError::Protocol("kayıtlı fiş numarası eksik".to_string()))
    };
    Ok(FiscalReceipt {
        unique_id: row
            .unique_id
            .clone()
            .ok_or_else(|| OkcError::Protocol("kayıtlı benzersiz numara eksik".to_string()))?,
        receipt_no: number(row.receipt_no)?,
        z_no: number(row.z_no)?,
        eku_no: number(row.eku_no)?,
        total_cents: row.total_cents,
    })
}

/// Tahsilat için fiş keser. `Ok(None)`: yazar kasa kapalı, akış değişmez.
///
/// `conn` tahsilatın açık işlemidir: başarılı fiş kaydı satışla aynı işlemde
/// kesinleşir. Hata dönerse çağıran işlemi geri alır ve `record_failure_after_rollback`
/// çağırır.
pub async fn issue_for_payment(
    conn: &mut SqliteConnection,
    connector: Arc<dyn DeviceConnector>,
    tenant_id: &str,
    order_id: Option<&str>,
    draft: ReceiptDraft,
) -> Result<Option<FiscalReceipt>, OkcError> {
    let settings = settings::load(conn, tenant_id)
        .await
        .map_err(OkcError::Settings)?;
    if !settings.enabled {
        return Ok(None);
    }
    settings.validate()?;
    draft.validate()?;
    if let Some(existing) = receipt_log::find(conn, tenant_id, &draft.basket_id)
        .await
        .map_err(OkcError::Settings)?
    {
        if existing.status == "ISSUED" {
            return stored_receipt(&existing).map(Some);
        }
    }
    let basket = draft.clone();
    let device_settings = settings.clone();
    let receipt = tokio::task::spawn_blocking(move || {
        issue_blocking(connector.as_ref(), &device_settings, &basket)
    })
    .await
    .map_err(|e| OkcError::Transport(format!("yazar kasa işi tamamlanamadı: {e}")))??;
    receipt_log::record_issued(conn, tenant_id, &draft.basket_id, order_id, &receipt)
        .await
        .map_err(OkcError::Settings)?;
    Ok(Some(receipt))
}

/// İşlem geri alındıktan sonra hatayı kalıcı uyarı olarak yazar. Yazma da
/// başarısız olursa asıl hata yine döner; uyarı kaybı ikincil hatadır.
pub async fn record_failure_after_rollback(
    pool: &DbPool,
    tenant_id: &str,
    transaction_id: &str,
    order_id: Option<&str>,
    total_cents: i64,
    error: &OkcError,
) {
    let Ok(mut tx) = pool.begin_write().await else {
        tracing::error!("yazar kasa uyarısı yazılamadı: işlem açılamadı");
        return;
    };
    if let Err(write_error) = receipt_log::record_failure(
        &mut tx,
        tenant_id,
        transaction_id,
        order_id,
        total_cents,
        error,
    )
    .await
    {
        tracing::error!("yazar kasa uyarısı yazılamadı: {write_error}");
        return;
    }
    if let Err(commit_error) = tx.commit().await {
        tracing::error!("yazar kasa uyarısı kesinleşmedi: {commit_error}");
    }
}
