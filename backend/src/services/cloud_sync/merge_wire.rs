//! Ada birleşmesinin (`ISLAND_MERGE`) buluta giden biçimi.
//!
//! Bulut yalnız `CHANGES`, `CARI`, `SET_MEMBERS` ve `NOOP` kabul eder. Birleşme
//! kaydı bu yüzden açılır: her ada işlemi kendi kimliğiyle `CHANGES` olarak gider
//! (`docs/local-network-sync.md`, "Bulut için günlük"), ardından birleşmenin vardığı
//! satırları taşıyan tek bir yerleşim işlemi gelir. Neden yerleşim: birleşme stok
//! farklarını toplar ve çakışmada küme değerini korur; ada görüntüsü tek başına
//! gönderilseydi bulutta son yazan kazanır, ada değeri doğru değeri ezerdi.
//!
//! Yerleşim bir kez üretilip saklanır: yanıtı kaybolan gönderim yeniden denenince
//! içerik aynı kalmalı, yoksa sunucu `OPERATION_CONFLICT` verirdi.

use super::wire::{self, KeyCache, LogFields, WireOperation};
use crate::services::lan_sync::op_log::intent_hash;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteArguments;
use sqlx::{Arguments, SqliteConnection};

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Yerleşim kimliği birleşmeye ve gönderen kasaya bağlıdır; iki kasa farklı anda
/// okuduğu satırları aynı kimlikle göndermez.
pub fn settle_id(merge_operation_id: &str, device_id: &str) -> String {
    let digest = hex::encode(Sha256::digest(
        format!("{merge_operation_id}\n{device_id}").as_bytes(),
    ));
    format!("ops_{}", &digest[..40])
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn bind(arguments: &mut SqliteArguments<'_>, value: &Value) -> Result<(), String> {
    let added = match value {
        Value::Null => arguments.add(Option::<String>::None),
        Value::Bool(flag) => arguments.add(i64::from(*flag)),
        Value::Number(number) => match (number.as_i64(), number.as_f64()) {
            (Some(integer), _) => arguments.add(integer),
            (None, Some(real)) => arguments.add(real),
            (None, None) => return Err("CLOUD_INVALID_LOG: anahtar sayısı okunamadı".to_string()),
        },
        Value::String(text) => arguments.add(text.clone()),
        other => arguments.add(other.to_string()),
    };
    added.map_err(|e| e.to_string())
}

/// Satırın bu cihazdaki güncel görüntüsü; yoksa silinmiştir.
async fn current_row(
    conn: &mut SqliteConnection,
    table: &str,
    key: &Map<String, Value>,
) -> Result<Option<Map<String, Value>>, String> {
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(text_error)?;
    if columns.is_empty() {
        return Err(format!("CLOUD_INVALID_LOG: {table} tablosu bu cihazda yok"));
    }
    let pairs: Vec<String> = columns
        .iter()
        .map(|column| format!("'{}', {}", column.replace('\'', "''"), quoted(column)))
        .collect();
    let mut arguments = SqliteArguments::default();
    let mut filter = Vec::new();
    for (column, value) in key {
        if !columns.contains(column) {
            return Err(format!(
                "CLOUD_INVALID_LOG: bilinmeyen sütun {table}.{column}"
            ));
        }
        filter.push(format!("{} IS ?", quoted(column)));
        bind(&mut arguments, value)?;
    }
    let statement = format!(
        "SELECT json_object({}) FROM {} WHERE {}",
        pairs.join(", "),
        quoted(table),
        filter.join(" AND ")
    );
    let text: Option<String> = sqlx::query_scalar_with(&statement, arguments)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?;
    text.map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .transpose()
}

async fn stored_settle(
    conn: &mut SqliteConnection,
    merge_operation_id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT operation FROM sync_cloud_settle WHERE merge_operation_id = ?")
        .bind(merge_operation_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)
}

/// Birleşmenin dokunduğu satırların güncel hâli; ilk üretimde saklanır.
async fn settle(
    conn: &mut SqliteConnection,
    fields: &LogFields<'_>,
    me: &str,
    touched: &[(String, Map<String, Value>)],
) -> Result<WireOperation, String> {
    if let Some(text) = stored_settle(conn, fields.operation_id).await? {
        return wire::from_stored(&text);
    }
    let mut seen = std::collections::HashSet::new();
    let mut changes = Vec::new();
    for (table, key) in touched {
        if !seen.insert(wire::key_text(table, key)) {
            continue;
        }
        match current_row(conn, table, key).await? {
            Some(row) => {
                changes.push(json!({ "table": table, "action": "I", "key": key, "row": row }))
            }
            None => changes.push(json!({ "table": table, "action": "D", "key": key, "row": null })),
        }
    }
    let changes = Value::Array(changes);
    let operation_id = settle_id(fields.operation_id, me);
    let operation = json!({
        "operationId": operation_id,
        "tenantId": fields.tenant_id,
        "deviceId": me,
        "actorId": "SYSTEM",
        "actorRole": "System",
        "intentSha256": intent_hash("CHANGES", &changes),
        "op": { "domain": "CHANGES", "body": { "base_state": 0, "changes": changes } },
        "createdAt": fields.created_at,
    })
    .to_string();
    sqlx::query(
        "INSERT INTO sync_cloud_settle (merge_operation_id, tenant_id, operation_id, operation)
         VALUES (?, ?, ?, ?) ON CONFLICT(merge_operation_id) DO NOTHING",
    )
    .bind(fields.operation_id)
    .bind(fields.tenant_id)
    .bind(&operation_id)
    .bind(&operation)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    let text = stored_settle(conn, fields.operation_id)
        .await?
        .ok_or_else(|| "INTERNAL: yerleşim işlemi okunamadı".to_string())?;
    wire::from_stored(&text)
}

/// Birleşme kaydını gönderilecek işlemlere açar: ada işlemleri, sonra yerleşim.
pub async fn expand(
    conn: &mut SqliteConnection,
    cache: &mut KeyCache,
    fields: &LogFields<'_>,
    body: &Value,
    me: &str,
) -> Result<Vec<WireOperation>, String> {
    let device_id = body
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or_else(|| "CLOUD_INVALID_LOG: birleşmenin cihazı yok".to_string())?;
    let entries = body
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "CLOUD_INVALID_LOG: birleşmenin işlemleri yok".to_string())?;
    let mut ordered: Vec<&Value> = entries.iter().collect();
    ordered.sort_by_key(|entry| entry.get("deviceSequence").and_then(Value::as_i64));
    let mut out = Vec::with_capacity(ordered.len() + 1);
    let mut touched = Vec::new();
    for entry in ordered {
        let text = |name: &str| {
            entry
                .get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("CLOUD_INVALID_LOG: ada işleminde {name} yok"))
        };
        let mut changes_body = json!({
            "base_state": entry.get("baseState").cloned().unwrap_or(json!(0)),
            "changes": entry.get("changes").cloned().unwrap_or(json!([])),
        });
        let count = wire::normalize_changes(conn, cache, &mut changes_body).await?;
        if let Some(changes) = changes_body.get("changes").and_then(Value::as_array) {
            for change in changes {
                let table = change.get("table").and_then(Value::as_str);
                let key = change.get("key").and_then(Value::as_object);
                if let (Some(table), Some(key)) = (table, key) {
                    touched.push((table.to_string(), key.clone()));
                }
            }
        }
        let changes = changes_body.get("changes").cloned().unwrap_or(json!([]));
        let json = json!({
            "operationId": text("operationId")?,
            "tenantId": fields.tenant_id,
            "deviceId": device_id,
            "actorId": text("actorId")?,
            "actorRole": text("actorRole")?,
            "intentSha256": intent_hash("CHANGES", &changes),
            "op": { "domain": "CHANGES", "body": changes_body },
            "createdAt": text("createdAt")?,
        });
        out.push(WireOperation {
            operation_id: text("operationId")?.to_string(),
            bytes: json.to_string().len(),
            changes: count,
            json,
        });
    }
    out.push(settle(conn, fields, me, &touched).await?);
    Ok(out)
}

/// Çıkışta bildirilen sayıma birleşmelerin katkısı: bu kasanın ada işlemleri ve
/// gönderdiği her yerleşim. Birleşme kaydının kendisi buluta gitmez.
pub async fn own_merge_operations(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    me: &str,
) -> Result<i64, String> {
    let payloads: Vec<String> = sqlx::query_scalar(
        "SELECT payload FROM sync_operations
         WHERE tenant_id = ? AND kind = 'ISLAND_MERGE' AND status = 'APPLIED'",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut count = 0;
    for text in payloads {
        let op: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        count += 1;
        if op.pointer("/body/deviceId").and_then(Value::as_str) == Some(me) {
            let entries = op
                .pointer("/body/entries")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            count += i64::try_from(entries).map_err(|e| e.to_string())?;
        }
    }
    Ok(count)
}
