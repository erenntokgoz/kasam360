//! Gönderici: imleçten sonraki işlemleri sırayla ve toplu olarak buluta yollar.
//!
//! İmleç yalnız sunucu kabul ettikten sonra ve aynı transaction'da ilerler; yanıt
//! kaybolursa aynı grup aynen yeniden gönderilir ve sunucu `duplicate` ile döner.
//! Onay bekleyen (`PROPOSED`) kayıtta durulur: sıra atlanırsa sonradan onaylanan
//! kayıt hiç gönderilmezdi.

use super::api::{ApiError, CloudApi, Credentials};
use super::state::{self, Identity};
use super::wire::{self, KeyCache, LogFields, WireOperation};
use super::SyncError;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};

/// Sözleşme sınırları. Bayt sınırı zarf ve çok baytlı karakter payıyla 4 MiB'ın altındadır.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub operations: usize,
    pub changes: usize,
    pub bytes: usize,
}

pub const LIMITS: Limits = Limits {
    operations: 500,
    changes: 10_000,
    bytes: 3_500_000,
};

fn text_error(error: sqlx::Error) -> SyncError {
    SyncError::Local(error.to_string())
}

enum Source {
    /// İlk yükleme kayıtları, konumlarıyla.
    Baseline(Vec<i64>),
    /// Günlük: bu gruptan sonra imlecin varacağı konum ve son işlem.
    Log {
        last_index: i64,
        last_operation: Option<String>,
    },
}

struct Batch {
    operations: Vec<WireOperation>,
    source: Source,
}

fn fits(limits: &Limits, batch: &[WireOperation], next: &WireOperation) -> bool {
    let changes: usize = batch.iter().map(|op| op.changes).sum();
    let bytes: usize = batch.iter().map(|op| op.bytes + 1).sum();
    batch.len() < limits.operations
        && changes + next.changes <= limits.changes
        && bytes + next.bytes + 16 <= limits.bytes
}

fn too_large(operation_id: &str) -> SyncError {
    SyncError::Permanent {
        code: "OPERATION_TOO_LARGE".to_string(),
        message: format!("İşlem gönderim sınırını aşıyor; işlem kimliği {operation_id}"),
    }
}

/// Sınırı tek başına aşan işlem bölünemez: işlem bütün olarak uygulanmalıdır.
fn admit(
    limits: &Limits,
    batch: &mut Vec<WireOperation>,
    next: WireOperation,
) -> Result<bool, SyncError> {
    if fits(limits, batch, &next) {
        batch.push(next);
        return Ok(true);
    }
    if batch.is_empty() {
        return Err(too_large(&next.operation_id));
    }
    Ok(false)
}

async fn baseline_batch(
    pool: &SqlitePool,
    identity: &Identity,
    limits: &Limits,
) -> Result<Option<Batch>, SyncError> {
    let mut conn = pool.acquire().await.map_err(text_error)?;
    let rows = sqlx::query(
        "SELECT position, operation_id, operation FROM sync_cloud_baseline
         WHERE tenant_id = ? AND pushed = 0 ORDER BY position LIMIT ?",
    )
    .bind(&identity.tenant_id)
    .bind(i64::try_from(limits.operations).map_err(|e| SyncError::Local(e.to_string()))?)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut operations = Vec::new();
    let mut positions = Vec::new();
    for row in rows {
        let position: i64 = row.try_get("position").map_err(text_error)?;
        let operation_id: String = row.try_get("operation_id").map_err(text_error)?;
        let text: String = row.try_get("operation").map_err(text_error)?;
        let rejected: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sync_cloud_review WHERE tenant_id = ? AND operation_id = ? AND decision = 'REJECTED')",
        ).bind(&identity.tenant_id).bind(&operation_id).fetch_one(&mut *conn).await.map_err(text_error)?;
        positions.push(position);
        if rejected {
            continue;
        }
        let operation = wire::from_stored(&text).map_err(SyncError::Local)?;
        if !admit(limits, &mut operations, operation)? {
            positions.pop();
            break;
        }
    }
    if operations.is_empty() && positions.is_empty() {
        return Ok(None);
    }
    Ok(Some(Batch {
        operations,
        source: Source::Baseline(positions),
    }))
}

async fn log_batch(
    pool: &SqlitePool,
    identity: &Identity,
    limits: &Limits,
) -> Result<Option<Batch>, SyncError> {
    let mut conn = pool.acquire().await.map_err(text_error)?;
    let cursor = state::log_cursor(&mut conn, identity)
        .await
        .map_err(SyncError::Local)?;
    let rows = sqlx::query(
        "SELECT operation_id, tenant_id, device_id, actor_id, actor_role, intent_sha256,
                payload, created_at, log_index, status
         FROM sync_operations WHERE tenant_id = ? AND log_index > ?
         ORDER BY log_index LIMIT ?",
    )
    .bind(&identity.tenant_id)
    .bind(cursor)
    .bind(i64::try_from(limits.operations).map_err(|e| SyncError::Local(e.to_string()))?)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut cache = KeyCache::default();
    let mut operations = Vec::new();
    let mut last_index = cursor;
    let mut last_operation = None;
    for row in rows {
        let status: String = row.try_get("status").map_err(text_error)?;
        let index: i64 = row.try_get("log_index").map_err(text_error)?;
        if status == "PROPOSED" {
            break;
        }
        if status == "REJECTED" {
            // Reddedilen işlem hiçbir cihazda uygulanmadı; buluta gitmez, sıra ilerler.
            last_index = index;
            continue;
        }
        let get = |name: &str| row.try_get::<String, _>(name).map_err(text_error);
        let (operation_id, tenant_id, device_id) =
            (get("operation_id")?, get("tenant_id")?, get("device_id")?);
        let cloud_rejected: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sync_cloud_review WHERE tenant_id = ? AND operation_id = ? AND decision = 'REJECTED')",
        ).bind(&identity.tenant_id).bind(&operation_id).fetch_one(&mut *conn).await.map_err(text_error)?;
        if cloud_rejected {
            last_index = index;
            last_operation = Some(operation_id);
            continue;
        }
        let (actor_id, actor_role, intent) =
            (get("actor_id")?, get("actor_role")?, get("intent_sha256")?);
        let (payload, created_at) = (get("payload")?, get("created_at")?);
        let fields = LogFields {
            operation_id: &operation_id,
            tenant_id: &tenant_id,
            device_id: &device_id,
            actor_id: &actor_id,
            actor_role: &actor_role,
            intent_sha256: &intent,
            payload: &payload,
            created_at: &created_at,
        };
        let expanded = wire::from_log(&mut conn, &mut cache, &fields, &identity.device_id)
            .await
            .map_err(|message| SyncError::Permanent {
                code: "CLOUD_INVALID_LOG".to_string(),
                message,
            })?;
        // Bir günlük kaydının işlemleri aynı gruba girer: imleç kayıt başına ilerler.
        let mut candidate = operations.clone();
        let mut admitted = true;
        for operation in expanded {
            if !admit(limits, &mut candidate, operation)? {
                admitted = false;
                break;
            }
        }
        if !admitted {
            if operations.is_empty() {
                return Err(too_large(&operation_id));
            }
            break;
        }
        operations = candidate;
        last_index = index;
        last_operation = Some(operation_id);
    }
    if last_index == cursor {
        return Ok(None);
    }
    Ok(Some(Batch {
        operations,
        source: Source::Log {
            last_index,
            last_operation,
        },
    }))
}

/// Sunucunun kabul listesi gönderilenle birebir aynı olmalı; değilse imleç ilerlemez.
fn verify_accepted(reply: &Value, sent: &[WireOperation]) -> Result<(), SyncError> {
    let accepted = reply
        .get("accepted")
        .and_then(Value::as_array)
        .ok_or_else(|| SyncError::Transient("Bulut yanıtında kabul listesi yok.".to_string()))?;
    let matches = accepted.len() == sent.len()
        && accepted.iter().zip(sent).all(|(item, op)| {
            item.get("operationId").and_then(Value::as_str) == Some(op.operation_id.as_str())
                && item.get("seq").and_then(Value::as_i64).is_some()
        });
    if !matches {
        return Err(SyncError::Permanent {
            code: "CLOUD_PROTOCOL".to_string(),
            message: "Bulut kabul listesi gönderilen işlemlerle eşleşmiyor.".to_string(),
        });
    }
    Ok(())
}

async fn commit_batch(
    pool: &SqlitePool,
    identity: &Identity,
    source: &Source,
    accepted: &[WireOperation],
) -> Result<(), SyncError> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(text_error)?;
    match source {
        Source::Baseline(positions) => {
            for position in positions {
                sqlx::query("UPDATE sync_cloud_baseline SET pushed = 1 WHERE position = ? AND tenant_id = ?")
                    .bind(position)
                    .bind(&identity.tenant_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(text_error)?;
            }
        }
        Source::Log {
            last_index,
            last_operation,
        } => {
            state::save_log_cursor(&mut tx, identity, *last_index, last_operation.as_deref())
                .await
                .map_err(SyncError::Local)?;
        }
    }
    state::mark_pushed(&mut tx)
        .await
        .map_err(SyncError::Local)?;
    for operation in accepted {
        state::accept_review(&mut tx, identity, &operation.operation_id)
            .await
            .map_err(SyncError::Local)?;
    }
    tx.commit().await.map_err(text_error)
}

pub fn classify(error: ApiError) -> SyncError {
    match error {
        ApiError::Transient(message) => SyncError::Transient(message),
        ApiError::Rejected {
            status: 401 | 403,
            code,
            message,
            ..
        } => SyncError::Halted { code, message },
        other => SyncError::Permanent {
            code: other.code().to_string(),
            message: other.message(),
        },
    }
}

/// Bekleyen her şeyi gönderir; gönderilen işlem sayısını döner.
pub async fn push_all<A: CloudApi>(
    pool: &SqlitePool,
    api: &A,
    credentials: &Credentials,
    identity: &Identity,
) -> Result<usize, SyncError> {
    let mut limits = LIMITS;
    let mut sent = 0;
    loop {
        let batch = match baseline_batch(pool, identity, &limits).await? {
            Some(batch) => Some(batch),
            None => log_batch(pool, identity, &limits).await?,
        };
        let Some(batch) = batch else {
            return Ok(sent);
        };
        if batch.operations.is_empty() {
            commit_batch(pool, identity, &batch.source, &[]).await?;
            continue;
        }
        let body = json!({
            "operations": batch.operations.iter().map(|op| &op.json).collect::<Vec<_>>(),
        })
        .to_string();
        match api.push(credentials, body).await {
            Ok(reply) => {
                verify_accepted(&reply, &batch.operations)?;
                commit_batch(pool, identity, &batch.source, &batch.operations).await?;
                sent += batch.operations.len();
                limits = LIMITS;
            }
            // Sunucu sınırı yereldekinden darsa grup küçültülür; tek işlem bölünemez.
            Err(ApiError::Rejected { status: 413, .. }) if batch.operations.len() > 1 => {
                limits.operations = batch.operations.len() / 2;
            }
            Err(ApiError::Rejected { status: 413, .. }) => {
                let id = batch
                    .operations
                    .first()
                    .map_or("", |op| op.operation_id.as_str());
                return Err(too_large(id));
            }
            Err(ApiError::Rejected {
                status: 202,
                code,
                message,
                detail,
            }) if code == "SYNC_REVIEW_REQUIRED" => {
                let ids = detail
                    .get("pending")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>();
                let mut conn = pool.acquire().await.map_err(text_error)?;
                for operation_id in ids {
                    state::record_review(&mut conn, identity, operation_id, "PENDING", &message)
                        .await
                        .map_err(SyncError::Local)?;
                }
                return Err(SyncError::Permanent { code, message });
            }
            Err(ApiError::Rejected {
                status: 409,
                code,
                message,
                detail,
            }) if code == "OPERATION_PENDING_REVIEW" => {
                if let Some(operation_id) = detail.get("operationId").and_then(Value::as_str) {
                    let mut conn = pool.acquire().await.map_err(text_error)?;
                    state::record_review(&mut conn, identity, operation_id, "PENDING", &message)
                        .await
                        .map_err(SyncError::Local)?;
                    return Err(SyncError::Permanent { code, message });
                }
                return Err(SyncError::Permanent { code, message });
            }
            Err(ApiError::Rejected {
                status: 409,
                code,
                message,
                detail,
            }) if code == "OPERATION_REJECTED" => {
                if let Some(operation_id) = detail.get("operationId").and_then(Value::as_str) {
                    let reason = detail
                        .get("reason")
                        .and_then(Value::as_str)
                        .unwrap_or(&message);
                    let mut conn = pool.acquire().await.map_err(text_error)?;
                    state::record_review(&mut conn, identity, operation_id, "REJECTED", reason)
                        .await
                        .map_err(SyncError::Local)?;
                    continue;
                }
                return Err(SyncError::Permanent { code, message });
            }
            Err(error) => return Err(classify(error)),
        }
    }
}
