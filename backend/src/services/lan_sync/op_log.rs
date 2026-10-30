//! Kalıcı işlem günlüğü: tekrar uygulama koruması ve sonuç sorgulama.
//!
//! Aynı `operation_id` kaç kez gelirse gelsin iş kayıtları bir kez yazılır ve
//! aynı sonuç döner. Bu sayede zaman aşımına uğrayan istemci parayı ikinci kez
//! göndermek yerine kimlikle sonucu sorar. Sonuç ve iş kayıtları aynı SQLite
//! transaction'ında yazıldığından "uygulandı ama sonucu kayboldu" durumu olmaz.

use super::store::Member;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::cari::{self, ApplyError, CariOp};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Acquire, Row, SqliteConnection, SqlitePool};

/// Günlüğe girebilen işlem türleri. Yalnız burada adı geçen tür eşitlenir;
/// bilinmeyen kayıt çözülemez ve işlem durur.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "domain", content = "body", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogOp {
    Cari(Box<CariOp>),
    SetMembers(Vec<Member>),
    Noop,
}

impl LogOp {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Cari(op) => op.kind(),
            Self::SetMembers(_) => "SET_MEMBERS",
            Self::Noop => "NOOP",
        }
    }

    pub fn target_id(&self) -> &str {
        match self {
            Self::Cari(op) => op.target_id(),
            Self::SetMembers(_) | Self::Noop => "cluster",
        }
    }
}

/// Kaynak cihazın bir kez ürettiği, her cihazda aynı uygulanan işlem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub operation_id: String,
    pub tenant_id: String,
    pub device_id: String,
    pub actor_id: String,
    pub actor_role: String,
    /// İstemcinin niyetinin özeti. Sunucunun ürettiği kimlik ve zaman dahil
    /// değildir; yoksa aynı isteğin yeniden denenmesi "farklı içerik" sayılırdı.
    pub intent_sha256: String,
    pub op: LogOp,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationStatus {
    /// Uygulandı; `result` kalıcı sonuçtur.
    Applied,
    /// İş kuralı reddetti; `error` kalıcı sonuçtur.
    Rejected,
    /// Günlükte, henüz çoğunlukla onaylanıp uygulanmadı.
    Pending,
    /// Bu cihazın günlüğünde yok.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationOutcome {
    pub operation_id: String,
    pub status: OperationStatus,
    pub result: Option<Value>,
    pub error: Option<String>,
}

impl OperationOutcome {
    pub fn unknown(operation_id: &str) -> Self {
        Self {
            operation_id: operation_id.to_string(),
            status: OperationStatus::Unknown,
            result: None,
            error: None,
        }
    }

    /// Reddi çağırana hata olarak taşır; bekleyen sonuç başarı sayılmaz.
    pub fn into_result(self) -> Result<Value, String> {
        match self.status {
            OperationStatus::Applied => self
                .result
                .ok_or_else(|| "INTERNAL: uygulanan işlemin sonucu eksik".to_string()),
            OperationStatus::Rejected => Err(self
                .error
                .unwrap_or_else(|| "REJECTED: işlem reddedildi".to_string())),
            OperationStatus::Pending | OperationStatus::Unknown => Err(format!(
                "PENDING_RESULT: işlem sonucu doğrulanamadı; işlem kimliği {}",
                self.operation_id
            )),
        }
    }
}

/// İstemci niyetinin kanonik özeti.
pub fn intent_hash(kind: &str, intent: &Value) -> String {
    let canonical = format!("{kind}\n{intent}");
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

fn validate(operation: &Operation) -> Result<(), String> {
    if operation.operation_id.trim().is_empty() || operation.tenant_id.trim().is_empty() {
        return Err("VALIDATION: işlem ve kiracı kimliği zorunludur".to_string());
    }
    Ok(())
}

fn outcome_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<OperationOutcome, String> {
    let operation_id: String = row.try_get("operation_id").map_err(|e| e.to_string())?;
    let status: String = row.try_get("status").map_err(|e| e.to_string())?;
    let result: Option<String> = row.try_get("result").map_err(|e| e.to_string())?;
    Ok(OperationOutcome {
        operation_id,
        status: match status.as_str() {
            "APPLIED" => OperationStatus::Applied,
            "REJECTED" => OperationStatus::Rejected,
            "PROPOSED" => OperationStatus::Pending,
            other => return Err(format!("INTERNAL: bilinmeyen işlem durumu: {other}")),
        },
        result: result
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|e| e.to_string())?,
        error: row.try_get("error").map_err(|e| e.to_string())?,
    })
}

/// Kimlik başka kiracının ya da başka içeriğin ise sonucu sızdırmadan reddeder.
pub async fn lookup(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    operation_id: &str,
    intent_sha256: Option<&str>,
) -> Result<Option<OperationOutcome>, String> {
    let row = sqlx::query(
        "SELECT operation_id, tenant_id, intent_sha256, status, result, error
         FROM sync_operations WHERE operation_id = ?",
    )
    .bind(operation_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(None);
    };
    let owner: String = row.try_get("tenant_id").map_err(|e| e.to_string())?;
    let stored_intent: String = row.try_get("intent_sha256").map_err(|e| e.to_string())?;
    if owner != tenant_id || intent_sha256.is_some_and(|intent| intent != stored_intent) {
        return Err("CONFLICT: aynı işlem kimliği farklı içerikle kullanılmış".to_string());
    }
    outcome_from_row(&row).map(Some)
}

/// İşlemi `PROPOSED` olarak günlüğe ekler; iş kayıtlarına dokunmaz.
pub async fn append(
    conn: &mut SqliteConnection,
    operation: &Operation,
    log_index: i64,
    log_term: i64,
) -> Result<(), String> {
    validate(operation)?;
    let payload = serde_json::to_string(&operation.op).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_operations (operation_id, tenant_id, device_id, actor_id, actor_role,
                                      target_id, kind, intent_sha256, payload, log_index,
                                      log_term, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?)",
    )
    .bind(&operation.operation_id)
    .bind(&operation.tenant_id)
    .bind(&operation.device_id)
    .bind(&operation.actor_id)
    .bind(&operation.actor_role)
    .bind(operation.op.target_id())
    .bind(operation.op.kind())
    .bind(&operation.intent_sha256)
    .bind(payload)
    .bind(log_index)
    .bind(log_term)
    .bind(&operation.created_at)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("İşlem günlüğe yazılamadı: {e}"))?;
    Ok(())
}

/// Günlükteki kaydı `Operation` değerine geri çevirir.
pub(super) fn operation_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Operation, String> {
    let payload: String = row.try_get("payload").map_err(|e| e.to_string())?;
    Ok(Operation {
        operation_id: row.try_get("operation_id").map_err(|e| e.to_string())?,
        tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
        device_id: row.try_get("device_id").map_err(|e| e.to_string())?,
        actor_id: row.try_get("actor_id").map_err(|e| e.to_string())?,
        actor_role: row.try_get("actor_role").map_err(|e| e.to_string())?,
        intent_sha256: row.try_get("intent_sha256").map_err(|e| e.to_string())?,
        op: serde_json::from_str(&payload).map_err(|e| format!("Bozuk işlem kaydı: {e}"))?,
        created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
    })
}

async fn apply_members(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    operation: &Operation,
    members: &[Member],
) -> Result<(), ApplyError> {
    let tenant_id = operation.tenant_id.as_str();
    // Cihaz ekranı üyeliği gösterir; üyelikten çıkan cihaz silinmez, pasif olur.
    sqlx::query("UPDATE devices SET status = 'INACTIVE' WHERE tenant_id = ?")
        .bind(tenant_id)
        .execute(&mut *conn)
        .await?;
    for member in members {
        sqlx::query(
            "INSERT INTO devices (id, tenant_id, name, device_type, status)
             VALUES (?, ?, ?, 'POS', 'ACTIVE')
             ON CONFLICT(id) DO UPDATE SET status = 'ACTIVE', name = excluded.name
             WHERE devices.tenant_id = excluded.tenant_id",
        )
        .bind(&member.device_id)
        .bind(tenant_id)
        .bind(&member.name)
        .execute(&mut *conn)
        .await?;
    }
    // Finansal yazabilen cihaz kümesi değişti: denetimde kalıcı iz bırakır.
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        operation.actor_id.clone(),
        operation.actor_role.clone(),
        category::GUVENLIK,
        "sync:members_changed",
        operation.operation_id.clone(),
        serde_json::json!({
            "members": members.iter().map(|m| &m.device_id).collect::<Vec<_>>(),
        }),
        operation.created_at.clone(),
    )
    .map_err(ApplyError::Internal)?;
    AuditService::append(conn, audit_lock, &ctx)
        .await
        .map_err(ApplyError::Internal)?;
    Ok(())
}

/// `PROPOSED` kaydı uygular; red ve başarı aynı transaction'da mühürlenir.
///
/// Altyapı hatasında tamamı geri alınır ve kayıt `PROPOSED` kalır; sahte
/// "reddedildi" sonucu kalıcı hale gelmez.
pub(super) async fn apply_proposed(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    operation: &Operation,
) -> Result<OperationOutcome, String> {
    let mut savepoint = conn.begin().await.map_err(|e| e.to_string())?;
    let applied = match &operation.op {
        LogOp::Cari(op) => {
            cari::apply(
                &mut savepoint,
                audit_lock,
                &operation.tenant_id,
                &operation.actor_id,
                &operation.actor_role,
                &operation.created_at,
                op,
            )
            .await
        }
        LogOp::SetMembers(members) => apply_members(&mut savepoint, audit_lock, operation, members)
            .await
            .map(|()| Value::Null),
        LogOp::Noop => Ok(Value::Null),
    };
    let (status, result, error) = match applied {
        Ok(value) => {
            savepoint.commit().await.map_err(|e| e.to_string())?;
            ("APPLIED", Some(value.to_string()), None)
        }
        Err(ApplyError::Rejected(message)) => {
            savepoint.rollback().await.map_err(|e| e.to_string())?;
            ("REJECTED", None, Some(message))
        }
        Err(ApplyError::Internal(message)) => {
            savepoint.rollback().await.map_err(|e| e.to_string())?;
            return Err(message);
        }
    };
    sqlx::query(
        "UPDATE sync_operations SET status = ?, result = ?, error = ?, applied_at = datetime('now')
         WHERE operation_id = ? AND tenant_id = ? AND status = 'PROPOSED'",
    )
    .bind(status)
    .bind(&result)
    .bind(&error)
    .bind(&operation.operation_id)
    .bind(&operation.tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    lookup(conn, &operation.tenant_id, &operation.operation_id, None)
        .await?
        .ok_or_else(|| "INTERNAL: işlem sonucu okunamadı".to_string())
}

/// Tek cihaz yolu: günlük, iş kayıtları, denetim ve sonuç tek transaction'dadır.
pub async fn execute_local(
    pool: &SqlitePool,
    audit_lock: &AuditLock<'_>,
    operation: &Operation,
) -> Result<OperationOutcome, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if let Some(existing) = lookup(
        &mut tx,
        &operation.tenant_id,
        &operation.operation_id,
        Some(&operation.intent_sha256),
    )
    .await?
    {
        return Ok(existing);
    }
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(log_index), 0) + 1 FROM sync_operations WHERE tenant_id = ?",
    )
    .bind(&operation.tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    append(&mut tx, operation, next, 0).await?;
    let outcome = apply_proposed(&mut tx, audit_lock, operation).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(outcome)
}

#[cfg(test)]
#[path = "op_log_tests.rs"]
mod tests;
