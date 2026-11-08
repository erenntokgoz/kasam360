//! Ada kaydının mühürlenmesi, geri alınması ve birleşmeye hazırlanması.
//!
//! Neden geri alma: ada cihazı otoriteyi yeniden görünce önce kendi ada
//! değişikliklerini önceki görüntülerle geri alır, sonra küme kayıtlarını uygular,
//! sonra ada işlemlerini `ISLAND_MERGE` olarak önerir. Böylece birleştirme her cihazda
//! aynı durum üzerinde, günlükteki aynı konumda çalışır ve aynı sonucu verir. Denetim
//! alt zinciri geri alınmaz: silinemez ve birleşmede olduğu gibi taşınır.

use super::capture::{self, RowChange};
use super::island::{self, IslandBase, IslandRecord};
use super::op_log::{intent_hash, LogOp, Operation};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::sqlite::SqliteArguments;
use sqlx::{Row, SqliteConnection};

/// Tek birleşme kaydına giren ada işlemi sayısı; şifreli çerçeve sınırının altında kalır.
const MERGE_BATCH: i64 = 50;

/// Geri alınmayan, birleşmede ayrı taşınan tablolar.
pub(super) const ISLAND_AUDIT: &str = "audit_island_ledger";

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandEntry {
    pub operation_id: String,
    pub island_epoch: String,
    pub device_sequence: i64,
    pub base_commit_index: i64,
    pub base_state: i64,
    pub actor_id: String,
    pub actor_role: String,
    pub kind: String,
    pub changes: Vec<RowChange>,
    pub created_at: String,
}

/// Bir cihazın sıralı ada işlemleri.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandBatch {
    pub device_id: String,
    pub entries: Vec<IslandEntry>,
}

/// Ada işleminin kimliği ve yazanı.
pub struct SealMeta {
    pub operation_id: String,
    pub actor_id: String,
    pub actor_role: String,
    pub kind: String,
    /// Boşsa niyet satır değişikliklerinin özetidir.
    pub intent_sha256: Option<String>,
    pub result: Value,
}

impl SealMeta {
    /// Komutun kendi kimliği olmayan satır yazması.
    pub fn changes() -> Self {
        Self {
            operation_id: crate::id_generator::generate_id("op"),
            actor_id: "SYSTEM".to_string(),
            actor_role: "System".to_string(),
            kind: "CHANGES".to_string(),
            intent_sha256: None,
            result: Value::Null,
        }
    }
}

/// Ada transaction'ını mühürler: yakalanan değişiklik ada kaydına girer, kapı kalkar.
/// Transaction'ı çağıran onaylar.
pub async fn seal(
    conn: &mut SqliteConnection,
    base: &IslandBase,
    meta: SealMeta,
) -> Result<(), String> {
    let changes = capture::read_capture(conn).await?;
    if !changes.is_empty() {
        let intent = match meta.intent_sha256 {
            Some(intent) => intent,
            None => {
                let value = serde_json::to_value(&changes).map_err(|e| e.to_string())?;
                intent_hash("CHANGES", &value)
            }
        };
        island::record(
            conn,
            base,
            &IslandRecord {
                operation_id: &meta.operation_id,
                actor_id: &meta.actor_id,
                actor_role: &meta.actor_role,
                kind: &meta.kind,
                intent_sha256: &intent,
                changes: &changes,
                result: &meta.result,
            },
        )
        .await?;
        capture::clear_capture(conn).await?;
    }
    sqlx::query("DELETE FROM sync_write_gate")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Birleşme kaydı otoriteye önerilmiş ama henüz uygulanmamış ada işlemi var mı?
pub async fn has_queued(conn: &mut SqliteConnection, tenant_id: &str) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_island_ops WHERE tenant_id = ? AND status = 'QUEUED'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(count > 0)
}

fn key_of(
    table: &str,
    keys: &[String],
    row: &Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    keys.iter()
        .map(|key| {
            row.get(key)
                .cloned()
                .map(|value| (key.clone(), value))
                .ok_or_else(|| format!("INTERNAL: anahtar sütunu eksik: {table}.{key}"))
        })
        .collect()
}

fn filter_of(
    arguments: &mut SqliteArguments<'_>,
    key: &Map<String, Value>,
) -> Result<String, String> {
    let mut parts = Vec::with_capacity(key.len());
    for (column, value) in key {
        parts.push(format!("{} IS ?", capture::quoted(column)));
        capture::bind(arguments, value)?;
    }
    if parts.is_empty() {
        return Err("INTERNAL: değişiklik anahtarı boş".to_string());
    }
    Ok(parts.join(" AND "))
}

/// Tek değişikliği önceki görüntüyle geri alır.
async fn undo_one(conn: &mut SqliteConnection, change: &RowChange) -> Result<(), String> {
    let table = change.table.as_str();
    if capture::is_origin_only(table) || table == ISLAND_AUDIT || table == "audit_ledger" {
        return Ok(());
    }
    let (columns, keys) = capture::table_shape(conn, table).await?;
    let target = capture::quoted(table);
    let mut arguments = SqliteArguments::default();
    let statement = match change.action.as_str() {
        "I" => {
            let row = change
                .row
                .as_ref()
                .ok_or_else(|| "INTERNAL: eklemede satır eksik".to_string())?;
            let key = key_of(table, &keys, row)?;
            format!(
                "DELETE FROM {target} WHERE {}",
                filter_of(&mut arguments, &key)?
            )
        }
        "U" => {
            let old = change
                .old
                .as_ref()
                .ok_or_else(|| "INTERNAL: güncellemede önceki görüntü eksik".to_string())?;
            let row = change
                .row
                .as_ref()
                .ok_or_else(|| "INTERNAL: güncellemede satır eksik".to_string())?;
            let mut sets = Vec::new();
            for (column, value) in old.iter().filter(|(c, _)| columns.contains(c)) {
                sets.push(format!("{} = ?", capture::quoted(column)));
                capture::bind(&mut arguments, value)?;
            }
            let key = key_of(table, &keys, row)?;
            let filter = filter_of(&mut arguments, &key)?;
            format!("UPDATE {target} SET {} WHERE {filter}", sets.join(", "))
        }
        "D" => {
            let old = change
                .old
                .as_ref()
                .ok_or_else(|| "INTERNAL: silmede önceki görüntü eksik".to_string())?;
            let mut names = Vec::new();
            for (column, value) in old.iter().filter(|(c, _)| columns.contains(c)) {
                names.push(capture::quoted(column));
                capture::bind(&mut arguments, value)?;
            }
            format!(
                "INSERT INTO {target} ({}) VALUES ({})",
                names.join(", "),
                vec!["?"; names.len()].join(", ")
            )
        }
        other => return Err(format!("INTERNAL: bilinmeyen değişiklik türü: {other}")),
    };
    sqlx::query_with(&statement, arguments)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("Ada değişikliği geri alınamadı ({table}): {e}"))?;
    Ok(())
}

/// Yerel ada değişikliklerini sondan başa geri alır ve kayıtları birleşme sırasına alır.
///
/// Çağıran `BEGIN IMMEDIATE` transaction'ı verir; yarım geri alma kalıcı olmaz.
pub async fn undo_local(conn: &mut SqliteConnection, tenant_id: &str) -> Result<usize, String> {
    let rows = sqlx::query(
        "SELECT changes FROM sync_island_ops
         WHERE tenant_id = ? AND status = 'LOCAL' ORDER BY device_sequence DESC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    if rows.is_empty() {
        return Ok(0);
    }
    sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('APPLY')")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    for row in &rows {
        let text: String = row.try_get("changes").map_err(text_error)?;
        let changes: Vec<RowChange> =
            serde_json::from_str(&text).map_err(|e| format!("Bozuk ada kaydı: {e}"))?;
        for change in changes.iter().rev() {
            undo_one(conn, change).await?;
        }
    }
    sqlx::query(
        "UPDATE sync_island_ops SET status = 'QUEUED' WHERE tenant_id = ? AND status = 'LOCAL'",
    )
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query("DELETE FROM sync_write_gate")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(rows.len())
}

/// Sıradaki birleşme kaydı. Önerilmiş ama uygulanmamış kayıt varsa aynı kimlikle
/// yeniden üretilir: tekrar gönderim ikinci birleşme açmaz.
pub async fn next_batch(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    device_id: &str,
) -> Result<Option<Operation>, String> {
    let inflight: Option<String> = sqlx::query_scalar(
        "SELECT merge_operation_id FROM sync_island_ops
         WHERE tenant_id = ? AND device_id = ? AND status = 'QUEUED'
           AND merge_operation_id IS NOT NULL
         ORDER BY device_sequence LIMIT 1",
    )
    .bind(tenant_id)
    .bind(device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let merge_id = match inflight {
        Some(id) => id,
        None => {
            let id = crate::id_generator::generate_id("op");
            let assigned = sqlx::query(
                "UPDATE sync_island_ops SET merge_operation_id = ?
                 WHERE operation_id IN (
                     SELECT operation_id FROM sync_island_ops
                     WHERE tenant_id = ? AND device_id = ? AND status = 'QUEUED'
                     ORDER BY device_sequence LIMIT ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(device_id)
            .bind(MERGE_BATCH)
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
            if assigned.rows_affected() == 0 {
                return Ok(None);
            }
            id
        }
    };
    let rows = sqlx::query(
        "SELECT operation_id, island_epoch, device_sequence, base_commit_index, base_state,
                actor_id, actor_role, kind, changes, created_at
         FROM sync_island_ops WHERE tenant_id = ? AND merge_operation_id = ?
         ORDER BY device_sequence",
    )
    .bind(tenant_id)
    .bind(&merge_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut entries = Vec::with_capacity(rows.len());
    for row in &rows {
        let changes: String = row.try_get("changes").map_err(text_error)?;
        entries.push(IslandEntry {
            operation_id: row.try_get("operation_id").map_err(text_error)?,
            island_epoch: row.try_get("island_epoch").map_err(text_error)?,
            device_sequence: row.try_get("device_sequence").map_err(text_error)?,
            base_commit_index: row.try_get("base_commit_index").map_err(text_error)?,
            base_state: row.try_get("base_state").map_err(text_error)?,
            actor_id: row.try_get("actor_id").map_err(text_error)?,
            actor_role: row.try_get("actor_role").map_err(text_error)?,
            kind: row.try_get("kind").map_err(text_error)?,
            changes: serde_json::from_str(&changes).map_err(|e| format!("Bozuk ada kaydı: {e}"))?,
            created_at: row.try_get("created_at").map_err(text_error)?,
        });
    }
    let ids: Vec<&str> = entries.iter().map(|e| e.operation_id.as_str()).collect();
    let intent = intent_hash("ISLAND_MERGE", &serde_json::json!(ids));
    Ok(Some(Operation {
        operation_id: merge_id,
        tenant_id: tenant_id.to_string(),
        device_id: device_id.to_string(),
        actor_id: "SYSTEM".to_string(),
        actor_role: "System".to_string(),
        intent_sha256: intent,
        op: LogOp::IslandMerge(Box::new(IslandBatch {
            device_id: device_id.to_string(),
            entries,
        })),
        created_at: chrono::Utc::now().to_rfc3339(),
    }))
}

/// Birleşen kayıtlar kaynak cihazda kapanır; yazma yeniden küme yoluna döner.
pub async fn mark_merged(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    merge_operation_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE sync_island_ops SET status = 'MERGED'
         WHERE tenant_id = ? AND merge_operation_id = ?",
    )
    .bind(tenant_id)
    .bind(merge_operation_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}
