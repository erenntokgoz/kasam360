//! İlk bağlanmada günlükten önce var olan satırların bir kez yüklenmesi.
//!
//! Bulut satır durumunu yalnız işlemlerden kurar. Günlük açılmadan önce yazılmış satır
//! (eski kurulum, yakalama öncesi sürüm) hiçbir işlemde geçmez; yüklenmezse buluttan
//! geri yüklenen kasada eksik kalırdı. Bu satırlar `I` değişiklikli `CHANGES`
//! işlemleriyle günlükten önce gönderilir.
//!
//! Neden yalnız günlükte hiç geçmeyen satırlar: günlükte geçen satırın son hâlini
//! günlüğün kendisi taşır. Aynı satır ilk yüklemeyle de gönderilseydi, yerel ağdaki
//! başka kasanın daha yeni işlemi sunucuda bu eski görüntüyle ezilebilirdi.

use super::state::{self, Identity};
use super::wire::{key_text, primary_keys};
use crate::services::lan_sync::op_log::intent_hash;
use crate::services::lan_sync::pairing;
use serde_json::{json, Map, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashSet;

/// Tek ilk yükleme işleminin sınırları; gönderim sınırlarının altında kalır.
const CHANGES_PER_OPERATION: usize = 500;
const BYTES_PER_OPERATION: usize = 512 * 1024;

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

fn change_key(change: &Value, keys_of: &dyn Fn(&str) -> Vec<String>) -> Option<String> {
    let table = change.get("table")?.as_str()?;
    if let Some(key) = change.get("key").and_then(Value::as_object) {
        return Some(key_text(table, key));
    }
    // Eski yakalama eklemede anahtar yazmıyordu; anahtar satırdan çıkarılır.
    let row = change.get("row")?.as_object()?;
    let mut key = Map::new();
    for column in keys_of(table) {
        key.insert(column.clone(), row.get(&column)?.clone());
    }
    Some(key_text(table, &key))
}

/// Günlükte ve birleşmeyi bekleyen ada kayıtlarında geçen satır anahtarları.
async fn touched_keys(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<HashSet<String>, String> {
    let mut payloads: Vec<Value> = Vec::new();
    let log: Vec<String> = sqlx::query_scalar(
        "SELECT payload FROM sync_operations WHERE tenant_id = ? AND kind = 'CHANGES'",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    for text in log {
        let op: Value =
            serde_json::from_str(&text).map_err(|e| format!("CLOUD_INVALID_LOG: {e}"))?;
        if let Some(changes) = op.pointer("/body/changes").and_then(Value::as_array) {
            payloads.extend(changes.iter().cloned());
        }
    }
    let island: Vec<String> =
        sqlx::query_scalar("SELECT changes FROM sync_island_ops WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(text_error)?;
    for text in island {
        let changes: Value =
            serde_json::from_str(&text).map_err(|e| format!("CLOUD_INVALID_LOG: {e}"))?;
        if let Some(changes) = changes.as_array() {
            payloads.extend(changes.iter().cloned());
        }
    }
    let mut tables: Vec<String> = payloads
        .iter()
        .filter_map(|change| change.get("table")?.as_str().map(str::to_string))
        .collect();
    tables.sort();
    tables.dedup();
    let mut keys = std::collections::HashMap::new();
    for table in tables {
        let columns = primary_keys(conn, &table).await?;
        keys.insert(table, columns);
    }
    let keys_of = |table: &str| keys.get(table).cloned().unwrap_or_default();
    Ok(payloads
        .iter()
        .filter_map(|change| change_key(change, &keys_of))
        .collect())
}

/// Günlükte geçmeyen satırları sırayla `I` değişikliğine çevirir.
async fn untouched_rows(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    touched: &HashSet<String>,
) -> Result<Vec<Value>, String> {
    let mut changes = Vec::new();
    for (table, rows) in pairing::export_snapshot(conn, tenant_id).await? {
        let keys = primary_keys(conn, &table).await?;
        if keys.is_empty() {
            return Err(format!(
                "CLOUD_KEY_MISSING: {table} tablosunun anahtarı yok"
            ));
        }
        let rows: Vec<Map<String, Value>> = serde_json::from_str(&rows)
            .map_err(|e| format!("Satırlar okunamadı ({table}): {e}"))?;
        for row in rows {
            let mut key = Map::new();
            for column in &keys {
                let value = row
                    .get(column)
                    .ok_or_else(|| format!("CLOUD_KEY_MISSING: {table}.{column} satırda yok"))?;
                key.insert(column.clone(), value.clone());
            }
            if touched.contains(&key_text(&table, &key)) {
                continue;
            }
            changes.push(json!({ "table": table, "action": "I", "key": key, "row": row }));
        }
    }
    Ok(changes)
}

fn chunk(changes: Vec<Value>) -> Vec<Vec<Value>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut bytes = 0;
    for change in changes {
        let size = change.to_string().len();
        if !current.is_empty()
            && (current.len() >= CHANGES_PER_OPERATION || bytes + size > BYTES_PER_OPERATION)
        {
            chunks.push(std::mem::take(&mut current));
            bytes = 0;
        }
        bytes += size;
        current.push(change);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// İlk yüklemeyi bir kez hazırlar. Kayıt ve "yapıldı" işareti aynı transaction'dadır:
/// yarıda kesilirse ikisi de yoktur ve sonraki açılışta yeniden hazırlanır.
pub async fn ensure(pool: &SqlitePool, identity: &Identity) -> Result<usize, String> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(text_error)?;
    if state::load(&mut tx).await?.baseline_done {
        return Ok(0);
    }
    let touched = touched_keys(&mut tx, &identity.tenant_id).await?;
    let changes = untouched_rows(&mut tx, &identity.tenant_id, &touched).await?;
    let start: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), 0) FROM sync_cloud_baseline")
            .fetch_one(&mut *tx)
            .await
            .map_err(text_error)?;
    let chunks = chunk(changes);
    let created_at = chrono::Utc::now().to_rfc3339();
    for (offset, changes) in chunks.iter().enumerate() {
        let operation_id = crate::id_generator::generate_id("op");
        let changes = Value::Array(changes.clone());
        let operation = json!({
            "operationId": operation_id,
            "tenantId": identity.tenant_id,
            "deviceId": identity.device_id,
            "actorId": "SYSTEM",
            "actorRole": "System",
            "intentSha256": intent_hash("CHANGES", &changes),
            "op": { "domain": "CHANGES", "body": { "base_state": 0, "changes": changes } },
            "createdAt": created_at,
        });
        let position = start + i64::try_from(offset).map_err(|e| e.to_string())? + 1;
        sqlx::query(
            "INSERT INTO sync_cloud_baseline (position, tenant_id, operation_id, operation)
             VALUES (?, ?, ?, ?)",
        )
        .bind(position)
        .bind(&identity.tenant_id)
        .bind(&operation_id)
        .bind(operation.to_string())
        .execute(&mut *tx)
        .await
        .map_err(text_error)?;
    }
    state::set_baseline_done(&mut tx).await?;
    tx.commit().await.map_err(text_error)?;
    Ok(chunks.len())
}

/// Buluttan geri yüklenen kasada ilk yükleme gerekmez: satırlar zaten buluttadır.
pub async fn skip(conn: &mut SqliteConnection) -> Result<(), String> {
    state::set_baseline_done(conn).await
}
