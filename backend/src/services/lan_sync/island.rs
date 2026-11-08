//! Ada modu kayıtları: otoriteye ulaşılamayan cihazın yerelde onayladığı işlemler.
//!
//! Kullanılabilirlik tutarlılıktan önce gelir: cihaz yalnız kalınca satış durmaz,
//! işlem yerelde onaylanır ve önceki görüntüleriyle bu tabloya eklenir. Kayıt
//! birleşene kadar silinmez; birleşme her cihazda aynı sonucu verecek biçimde küme
//! günlüğünden yürür (`docs/local-network-sync.md`).
//!
//! Neden ayrı tablo: ada kaydı küme sırası (`log_index`) almamıştır. Küme günlüğüne
//! sahte sıra yazmak otoritenin günlüğüyle çakışır, ikinci kez uygulanmasına yol açardı.

use super::capture::RowChange;
use super::op_log::{OperationOutcome, OperationStatus};
use serde_json::Value;
use sqlx::{Row, SqliteConnection};

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Ada işleminin başladığı küme durumu: birleşmede nedensellik dayanağıdır.
pub struct IslandBase {
    pub tenant_id: String,
    pub device_id: String,
    pub base_commit_index: i64,
    pub base_state: i64,
}

/// Kaydedilecek ada işlemi.
pub struct IslandRecord<'a> {
    pub operation_id: &'a str,
    pub actor_id: &'a str,
    pub actor_role: &'a str,
    pub kind: &'a str,
    pub intent_sha256: &'a str,
    pub changes: &'a [RowChange],
    pub result: &'a Value,
}

/// Birleşmeyi bekleyen yerel ada kaydı var mı? Varsa cihaz yalnız ada yolundan yazar:
/// ada durumuna dayanan yazma kümeye gönderilirse diğer cihazlarda dayanaksız kalırdı.
pub async fn has_local(conn: &mut SqliteConnection, tenant_id: &str) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_island_ops WHERE tenant_id = ? AND status = 'LOCAL'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(count > 0)
}

/// Açık ada döneminin kimliği; yoksa yeni dönem açılır.
async fn epoch(conn: &mut SqliteConnection, base: &IslandBase) -> Result<String, String> {
    let open: Option<String> = sqlx::query_scalar(
        "SELECT island_epoch FROM sync_island_ops
         WHERE tenant_id = ? AND device_id = ? AND status = 'LOCAL'
         ORDER BY device_sequence DESC LIMIT 1",
    )
    .bind(&base.tenant_id)
    .bind(&base.device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(open.unwrap_or_else(|| crate::id_generator::generate_id("isl")))
}

/// İşlemi ada kaydı olarak ekler; iş satırlarıyla aynı transaction'da çağrılır.
pub async fn record(
    conn: &mut SqliteConnection,
    base: &IslandBase,
    record: &IslandRecord<'_>,
) -> Result<i64, String> {
    let epoch = epoch(conn, base).await?;
    let sequence: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(device_sequence), 0) + 1 FROM sync_island_ops
         WHERE tenant_id = ? AND device_id = ?",
    )
    .bind(&base.tenant_id)
    .bind(&base.device_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let changes = serde_json::to_string(record.changes).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_island_ops (operation_id, tenant_id, device_id, island_epoch,
                                      device_sequence, base_commit_index, base_state, actor_id,
                                      actor_role, kind, intent_sha256, changes, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(record.operation_id)
    .bind(&base.tenant_id)
    .bind(&base.device_id)
    .bind(epoch)
    .bind(sequence)
    .bind(base.base_commit_index)
    .bind(base.base_state)
    .bind(record.actor_id)
    .bind(record.actor_role)
    .bind(record.kind)
    .bind(record.intent_sha256)
    .bind(changes)
    .bind(record.result.to_string())
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Ada kaydı yazılamadı: {e}"))?;
    Ok(sequence)
}

/// Ada işleminin kalıcı sonucu; tekrar gelen kimlik ikinci kez yazılmaz.
pub async fn lookup(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    operation_id: &str,
    intent_sha256: Option<&str>,
) -> Result<Option<OperationOutcome>, String> {
    let row = sqlx::query(
        "SELECT intent_sha256, result FROM sync_island_ops
         WHERE operation_id = ? AND tenant_id = ?",
    )
    .bind(operation_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let stored: String = row.try_get("intent_sha256").map_err(text_error)?;
    if intent_sha256.is_some_and(|intent| intent != stored) {
        return Err("CONFLICT: aynı işlem kimliği farklı içerikle kullanılmış".to_string());
    }
    let result: Option<String> = row.try_get("result").map_err(text_error)?;
    Ok(Some(OperationOutcome {
        operation_id: operation_id.to_string(),
        status: OperationStatus::Applied,
        result: result
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|e| e.to_string())?,
        error: None,
    }))
}

#[cfg(test)]
#[path = "island_tests.rs"]
mod tests;
