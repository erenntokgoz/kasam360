//! Kuyruk işleyicisi: GÖNDERİLECEK belgeleri sağlayıcıya iletir.
//!
//! Neden denetim kilidi gönderimden sonra alınır: sağlayıcı çağrısı saniyelerce
//! sürebilir; kilit tutulursa ödeme denetim kayıtları beklerdi. Sonuç tek kısa
//! yazma işleminde kaydedilir. Tek seferde tek işleyici çalışır; eşzamanlı ikinci
//! çağrı sırada bekler.
//!
//! Hata sınıfları: yapılandırılmamış sağlayıcı ve ağ kesintisi belgeyi GÖNDERİLECEK
//! durumunda bırakır ve deneme sayılmaz; yalnız sağlayıcının kalıcı reddi HATA yapar.

use sqlx::{Row, SqlitePool};

use super::provider::{EDocumentProvider, ProviderError, RemoteStatus, SendReceipt};
use super::queue::{self, SENT};
use super::settings;
use crate::services::audit_service::AuditLock;
use crate::services::lan_sync::WritePool;

static DISPATCH_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchReport {
    pub sent: i64,
    pub failed: i64,
    /// Ağ yok nedeniyle kuyrukta bekleyenler.
    pub deferred: i64,
}

pub struct Actor<'a> {
    pub tenant_id: &'a str,
    pub id: &'a str,
    pub role: &'a str,
}

struct Pending {
    id: String,
    ettn: String,
    xml: String,
}

async fn load_pending(
    pool: &SqlitePool,
    tenant_id: &str,
    limit: i64,
) -> Result<Vec<Pending>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT id, ettn, xml FROM e_document_queue \
         WHERE tenant_id = ? AND status = 'PENDING' ORDER BY created_at, id LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            Ok(Pending {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                ettn: row.try_get("ettn").map_err(|e| e.to_string())?,
                xml: row.try_get("xml").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

async fn deliver(
    provider: &dyn EDocumentProvider,
    doc: &Pending,
) -> Result<SendReceipt, ProviderError> {
    let signed = provider.sign(&doc.xml).await?;
    provider.send(&doc.ettn, &signed).await
}

/// Sonucu tek kısa yazma işleminde kaydeder; durum koruması yarışta çifte kaydı önler.
async fn record(
    pool: &SqlitePool,
    audit_mutex: &tokio::sync::Mutex<()>,
    actor: &Actor<'_>,
    doc: &Pending,
    outcome: &Result<SendReceipt, ProviderError>,
) -> Result<(), String> {
    let lock = AuditLock::new(audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    let (sql, error, reference, action) = match outcome {
        Ok(receipt) => (
            "UPDATE e_document_queue SET status = 'SENT', attempts = attempts + 1, last_error = NULL, \
                provider_ref = ?, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
             WHERE tenant_id = ? AND id = ? AND status = 'PENDING'",
            None,
            Some(receipt.provider_ref.as_str()),
            "e_document:sent",
        ),
        Err(ProviderError::Rejected(_)) => (
            "UPDATE e_document_queue SET status = 'FAILED', attempts = attempts + 1, last_error = ?, \
                updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ? AND status = 'PENDING'",
            outcome.as_ref().err().map(ProviderError::message),
            None,
            "e_document:failed",
        ),
        Err(other) => (
            "UPDATE e_document_queue SET last_error = ?, updated_at = CURRENT_TIMESTAMP \
             WHERE tenant_id = ? AND id = ? AND status = 'PENDING'",
            Some(other.message()),
            None,
            "e_document:deferred",
        ),
    };
    let bound = error.as_deref().or(reference);
    let result = sqlx::query(sql)
        .bind(bound)
        .bind(actor.tenant_id)
        .bind(&doc.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 1 {
        queue::audit(
            &mut tx,
            &lock,
            actor.tenant_id,
            actor.id,
            actor.role,
            action,
            &doc.id,
            serde_json::json!({ "ettn": doc.ettn }),
        )
        .await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// GÖNDERİLECEK belgeleri sırayla gönderir. e-Adisyon kapalıysa ve sağlayıcı
/// yapılandırılmamışsa hiçbir belge işlenmez ve açık hata döner.
pub async fn dispatch_pending(
    pool: &SqlitePool,
    audit_mutex: &tokio::sync::Mutex<()>,
    provider: &dyn EDocumentProvider,
    actor: &Actor<'_>,
    limit: i64,
) -> Result<DispatchReport, String> {
    {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        if !settings::get(&mut conn, actor.tenant_id).await?.enabled {
            return Err("DISABLED: e-Adisyon kapalı".to_string());
        }
    }
    // Bekleyen ikinci çağrı, ilkinin gönderdiklerini artık PENDING görmez; çift gönderim olmaz.
    let _gate = DISPATCH_GATE.lock().await;
    let mut report = DispatchReport::default();
    for doc in load_pending(pool, actor.tenant_id, limit).await? {
        let outcome = deliver(provider, &doc).await;
        if outcome == Err(ProviderError::NotConfigured) {
            return Err(format!(
                "PROVIDER: {}",
                ProviderError::NotConfigured.message()
            ));
        }
        record(pool, audit_mutex, actor, &doc, &outcome).await?;
        match outcome {
            Ok(_) => report.sent += 1,
            Err(ProviderError::Rejected(_)) => report.failed += 1,
            Err(_) => {
                // Ağ yok: kalanları denemek aynı hatayı tekrarlar; sıra korunarak durulur.
                report.deferred += 1;
                break;
            }
        }
    }
    Ok(report)
}

/// GÖNDERİLDİ belgenin sağlayıcıdaki durumunu sorgular ve kaydeder. Sağlayıcı
/// reddi belgeyi HATA durumuna alır; kabul ve bekleme yalnız durum metnini günceller.
pub async fn refresh_status(
    pool: &SqlitePool,
    audit_mutex: &tokio::sync::Mutex<()>,
    provider: &dyn EDocumentProvider,
    actor: &Actor<'_>,
    id: &str,
) -> Result<queue::QueueEntry, String> {
    let entry = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        queue::find(&mut conn, actor.tenant_id, id)
            .await?
            .ok_or_else(|| "NOT_FOUND: belge bulunamadı".to_string())?
    };
    if entry.status != SENT {
        return Err("CONFLICT: yalnız gönderilmiş belgenin durumu sorgulanır".to_string());
    }
    let remote = provider
        .status(&entry.ettn)
        .await
        .map_err(|e| format!("PROVIDER: {}", e.message()))?;
    let (label, failure) = match &remote {
        RemoteStatus::Accepted => ("ACCEPTED", None),
        RemoteStatus::Pending => ("PENDING", None),
        RemoteStatus::Rejected(reason) => ("REJECTED", Some(reason.as_str())),
    };
    let lock = AuditLock::new(audit_mutex.lock().await);
    let mut tx = pool.begin_write().await?;
    sqlx::query(
        "UPDATE e_document_queue SET remote_status = ?, \
            status = CASE WHEN ? IS NULL THEN status ELSE 'FAILED' END, \
            last_error = COALESCE(?, last_error), updated_at = CURRENT_TIMESTAMP \
         WHERE tenant_id = ? AND id = ? AND status = 'SENT'",
    )
    .bind(label)
    .bind(failure)
    .bind(failure)
    .bind(actor.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    queue::audit(
        &mut tx,
        &lock,
        actor.tenant_id,
        actor.id,
        actor.role,
        "e_document:status_checked",
        id,
        serde_json::json!({ "remoteStatus": label }),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queue::find(&mut conn, actor.tenant_id, id)
        .await?
        .ok_or_else(|| "belge güncellendikten sonra okunamadı".to_string())
}
