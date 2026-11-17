//! Tahsilat ile yazar kasa fişi arasındaki kapı.
//!
//! Neden ayrı dosya: tekil ve adisyon tahsilatı aynı kuralı paylaşır. Yazar kasa
//! kapalıysa (varsayılan) hiçbir şey değişmez. Açıksa fiş kesilmeden tahsilat
//! kesinleşmez; hata durumunda çağıran işlemi bırakır (geri alır), adisyon açık
//! kalır ve hata kalıcı uyarı olarak yazılır.

use std::sync::Arc;

use sqlx::SqliteConnection;

use super::types::PaymentPayloadDto;
use crate::db::DbPool;
use crate::services::okc::gate::{self, SystemConnector};
use crate::services::okc::receipt_draft::draft_for_payment;
use crate::services::okc::settings;
use crate::services::okc::types::{FiscalReceipt, OkcError};

/// Tahsilat için fiş keser. `Ok(None)`: yazar kasa kapalı veya fişe girecek ödeme yok.
pub(super) async fn issue_receipt(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    payload: &PaymentPayloadDto,
) -> Result<Option<FiscalReceipt>, OkcError> {
    let configured = settings::load(conn, tenant_id)
        .await
        .map_err(OkcError::Settings)?;
    if !configured.enabled {
        return Ok(None);
    }
    let Some(draft) = draft_for_payment(conn, tenant_id, payload).await? else {
        return Ok(None);
    };
    gate::issue_for_payment(
        conn,
        Arc::new(SystemConnector),
        tenant_id,
        payload.order_id.as_deref(),
        draft,
    )
    .await
}

/// Hata sonrası: çağıran işlemi bıraktıktan SONRA çağrılır (yazma kilidi serbesttir).
/// Uyarıyı yazar ve istemciye gidecek `KOD: açıklama` metnini döndürür.
pub(super) async fn fail_closed(
    pool: &DbPool,
    tenant_id: &str,
    payload: &PaymentPayloadDto,
    error: &OkcError,
) -> String {
    gate::record_failure_after_rollback(
        pool,
        tenant_id,
        &payload.transaction_id,
        payload.order_id.as_deref(),
        payload.total_amount,
        error,
    )
    .await;
    format!(
        "{} Tahsilat tamamlanmadı; adisyon açık kaldı. Yazar kasayı kontrol edip tekrar deneyin.",
        error.to_command_error()
    )
}

/// Arayüzde gösterilecek mali fiş numarası; cihaz numarası varsa simge değil gerçek numara.
pub(super) fn receipt_label(receipt: &FiscalReceipt) -> String {
    format!("Z{}-F{}", receipt.z_no, receipt.receipt_no)
}
