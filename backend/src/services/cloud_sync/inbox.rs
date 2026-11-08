//! Çekici: diğer kasaların buluttaki işlemlerini alır ve yerelde uygular.
//!
//! Aynı işlem yerel ağdan zaten gelmiş olabilir; kimliği günlükte, ada kaydında veya
//! buluttan uygulananlarda olan işlem atlanır. Uygulama yerel ağın uygulama yoluyla
//! (`capture::apply_changes`, `cari::apply`) ve `APPLY` kapısı altında yapılır: gelen
//! satır yeniden yakalanıp buluta geri gönderilmez.
//!
//! Sayfa tek transaction'dır: işlemler, uygulandı kaydı ve imleç birlikte yazılır.
//! Bir işlem altyapı hatası verirse sayfa bütünüyle geri alınır ve imleç ilerlemez.

use super::api::{CloudApi, Credentials};
use super::state::{self, Identity};
use super::wire::KeyCache;
use super::SyncError;
use crate::services::audit_service::AuditLock;
use crate::services::cari::{self, ApplyError};
use crate::services::lan_sync::capture::{self, RowChange};
use crate::services::lan_sync::op_log::LogOp;
use crate::services::lan_sync::{island, store};
use serde_json::Value;
use sqlx::{Acquire, SqliteConnection, SqlitePool};
use std::sync::Arc;

pub const PULL_LIMIT: i64 = 200;

/// Denetim zinciri cihazdaki SHA-256 zinciridir; başka kasanın zincir satırı yerel
/// zincirin ucuna eklenemez. Bu satırlar bulutta kalır, yerelde uygulanmaz.
const CHAIN_TABLES: [&str; 2] = ["audit_ledger", "audit_island_ledger"];

fn local(error: impl ToString) -> SyncError {
    SyncError::Local(error.to_string())
}

/// Bulutta `U` ekle-veya-güncelle anlamındadır: anlık görüntüden sonra değişen satır
/// yerelde hiç olmayabilir. Yerel `I` yolu çakışmada günceller; anahtarı değiştiren
/// `U` eski anahtarı siler.
pub async fn as_upsert(
    conn: &mut SqliteConnection,
    cache: &mut KeyCache,
    changes: Vec<RowChange>,
) -> Result<Vec<RowChange>, String> {
    let mut out = Vec::with_capacity(changes.len());
    for mut change in changes {
        if CHAIN_TABLES.contains(&change.table.as_str()) {
            continue;
        }
        change.old = None;
        if change.action != "U" {
            out.push(change);
            continue;
        }
        let keys = cache.keys(conn, &change.table).await?;
        let row = change
            .row
            .clone()
            .ok_or_else(|| format!("INTERNAL: {} güncellemesinde satır yok", change.table))?;
        let new_key: serde_json::Map<String, Value> = keys
            .iter()
            .filter_map(|column| row.get(column).map(|value| (column.clone(), value.clone())))
            .collect();
        let moved =
            new_key.len() == keys.len() && change.key.as_ref().is_some_and(|old| old != &new_key);
        if moved {
            out.push(RowChange {
                table: change.table.clone(),
                action: "D".to_string(),
                key: change.key.clone(),
                row: None,
                old: None,
            });
        }
        out.push(RowChange {
            action: "I".to_string(),
            key: Some(new_key),
            ..change
        });
    }
    Ok(out)
}

/// Bu kasada zaten bulunan işlem mi? Yerel günlük, ada kaydı ve buluttan uygulananlar.
async fn already_here(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    operation_id: &str,
) -> Result<bool, String> {
    let found: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM sync_operations WHERE tenant_id = ?1 AND operation_id = ?2)
              + (SELECT COUNT(*) FROM sync_island_ops WHERE tenant_id = ?1 AND operation_id = ?2)
              + (SELECT COUNT(*) FROM merged_island_ops
                 WHERE tenant_id = ?1 AND island_operation_id = ?2)
              + (SELECT COUNT(*) FROM sync_cloud_applied WHERE tenant_id = ?1 AND operation_id = ?2)",
    )
    .bind(tenant_id)
    .bind(operation_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(found > 0)
}

async fn record(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    operation_id: &str,
    seq: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO sync_cloud_applied (tenant_id, operation_id, seq, status, error, applied_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(tenant_id)
    .bind(operation_id)
    .bind(seq)
    .bind(status)
    .bind(error)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bu kasanın yerel ağ kümesindeki cihazlar. Onların işlemleri yerel ağdan gelir:
/// buluttan da uygulanırsa günlükteki daha yeni satırı eski görüntüyle ezerdi.
async fn cluster_members(conn: &mut SqliteConnection) -> Result<Vec<String>, String> {
    let Some(row) = store::load_cluster(conn).await? else {
        return Ok(Vec::new());
    };
    Ok(store::current_members(conn, &row)
        .await?
        .into_iter()
        .map(|member| member.device_id)
        .collect())
}

/// Tek işlemi uygular; iş kuralı reddi kalıcı sonuçtur ve kayda geçer, sessiz geçilmez.
async fn apply_one(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    cache: &mut KeyCache,
    tenant_id: &str,
    operation: &Value,
) -> Result<(&'static str, Option<String>), SyncError> {
    let field = |name: &str| operation.get(name).and_then(Value::as_str).unwrap_or("");
    let op_value = operation
        .get("op")
        .cloned()
        .ok_or_else(|| local("CLOUD_PROTOCOL: işlem gövdesi yok"))?;
    let op: LogOp = serde_json::from_value(op_value).map_err(|e| SyncError::Permanent {
        code: "CLOUD_UNKNOWN_OPERATION".to_string(),
        message: format!(
            "Buluttan gelen işlem bu sürümde tanınmıyor ({}): {e}",
            field("operationId")
        ),
    })?;
    match op {
        LogOp::Changes { changes, .. } => {
            let changes = as_upsert(conn, cache, changes).await.map_err(local)?;
            capture::apply_changes(conn, &changes, false)
                .await
                .map_err(local)?;
            Ok(("APPLIED", None))
        }
        LogOp::Cari(op) => {
            let mut savepoint = conn.begin().await.map_err(local)?;
            let applied = cari::apply(
                &mut savepoint,
                audit_lock,
                tenant_id,
                field("actorId"),
                field("actorRole"),
                field("createdAt"),
                &op,
            )
            .await;
            match applied {
                Ok(_) => {
                    savepoint.commit().await.map_err(local)?;
                    Ok(("APPLIED", None))
                }
                Err(ApplyError::Rejected(message)) => {
                    savepoint.rollback().await.map_err(local)?;
                    tracing::warn!("Buluttan gelen cari işlemi reddedildi: {message}");
                    Ok(("REJECTED", Some(message)))
                }
                Err(ApplyError::Internal(message)) => Err(local(message)),
            }
        }
        // Üyelik başka bir yerel ağa aittir; bu kasanın kümesini değiştirmez. Birleşme
        // kaydı buluta açılmış gider (`merge_wire`); bulutta bu biçimde durmaz.
        LogOp::SetMembers(_) | LogOp::IslandMerge(_) | LogOp::Noop => Ok(("SKIPPED", None)),
    }
}

/// Bir sayfayı uygular. `rejected`: iş kuralınca reddedilen işlem sayısı.
pub struct PageResult {
    pub applied: usize,
    pub rejected: usize,
}

pub async fn apply_page(
    pool: &SqlitePool,
    audit_mutex: &Arc<tokio::sync::Mutex<()>>,
    identity: &Identity,
    operations: &[Value],
    next_after: i64,
) -> Result<PageResult, SyncError> {
    // Denetim kilidi transaction'dan önce alınır; yazma yollarıyla aynı sıra.
    let audit_lock = AuditLock::new(audit_mutex.lock().await);
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(local)?;
    sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('APPLY')")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    let mut cache = KeyCache::default();
    let members = cluster_members(&mut tx).await.map_err(local)?;
    let mut result = PageResult {
        applied: 0,
        rejected: 0,
    };
    for operation in operations {
        let text = |name: &str| {
            operation
                .get(name)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let (Some(operation_id), Some(device_id), Some(seq)) = (
            text("operationId"),
            text("deviceId"),
            operation.get("seq").and_then(Value::as_i64),
        ) else {
            return Err(local(
                "CLOUD_PROTOCOL: işlem kimliği, cihaz veya sıra eksik",
            ));
        };
        if text("tenantId").as_deref() != Some(identity.tenant_id.as_str()) {
            return Err(SyncError::Permanent {
                code: "TENANT_MISMATCH".to_string(),
                message: "Buluttan başka işletmenin işlemi geldi.".to_string(),
            });
        }
        // Kendi işlemi ve yerel ağdan gelmiş işlem ikinci kez uygulanmaz.
        if device_id == identity.device_id
            || members.contains(&device_id)
            || already_here(&mut tx, &identity.tenant_id, &operation_id)
                .await
                .map_err(local)?
        {
            continue;
        }
        let (status, error) = apply_one(
            &mut tx,
            &audit_lock,
            &mut cache,
            &identity.tenant_id,
            operation,
        )
        .await?;
        if status == "REJECTED" {
            result.rejected += 1;
        } else {
            result.applied += 1;
        }
        record(
            &mut tx,
            &identity.tenant_id,
            &operation_id,
            seq,
            status,
            error.as_deref(),
        )
        .await
        .map_err(local)?;
    }
    sqlx::query("DELETE FROM sync_write_gate")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    state::save_pull_after(&mut tx, next_after)
        .await
        .map_err(local)?;
    tx.commit().await.map_err(local)?;
    Ok(result)
}

/// `hasMore` bitene kadar çeker. Bekleyen ada kaydı varken çekilmez: ada değişiklikleri
/// birleşmeden önce önceki görüntüleriyle geri alınır, arada yazılan satır bozulurdu.
pub async fn pull_all<A: CloudApi>(
    pool: &SqlitePool,
    audit_mutex: &Arc<tokio::sync::Mutex<()>>,
    api: &A,
    credentials: &Credentials,
    identity: &Identity,
) -> Result<PageResult, SyncError> {
    let mut total = PageResult {
        applied: 0,
        rejected: 0,
    };
    loop {
        let after = {
            let mut conn = pool.acquire().await.map_err(local)?;
            if island::has_local(&mut conn, &identity.tenant_id)
                .await
                .map_err(local)?
            {
                return Ok(total);
            }
            state::load(&mut conn).await.map_err(local)?.pull_after
        };
        let reply = api
            .pull(credentials, after, PULL_LIMIT)
            .await
            .map_err(super::outbox::classify)?;
        if reply.get("tenantId").is_none_or(Value::is_null) {
            return Ok(total);
        }
        let operations = reply
            .get("operations")
            .and_then(Value::as_array)
            .ok_or_else(|| local("CLOUD_PROTOCOL: işlem listesi yok"))?;
        let next_after = reply
            .get("nextAfter")
            .and_then(Value::as_i64)
            .ok_or_else(|| local("CLOUD_PROTOCOL: sonraki sıra yok"))?;
        let page = apply_page(pool, audit_mutex, identity, operations, next_after).await?;
        total.applied += page.applied;
        total.rejected += page.rejected;
        if !reply
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || next_after <= after
        {
            return Ok(total);
        }
    }
}
