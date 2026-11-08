//! Ada işlemlerinin küme durumuna deterministik birleştirilmesi.
//!
//! Birleşme kaydı günlükte tek konumdadır ve her cihazda aynı durum üzerinde çalışır
//! (ada cihazı kendi değişikliklerini önceden geri almıştır). Kurallar yalnız satır
//! görüntülerine bakar, saat veya rastgelelik kullanmaz; her cihaz aynı sonucu üretir.
//!
//! Satır üç yönlü karşılaştırılır: önceki görüntü (ada başlangıcı), ada görüntüsü ve
//! güncel küme satırı. Yalnız bir tarafın değiştirdiği sütun o taraftan alınır; iki
//! tarafın değiştirdiği sütunda küme değeri kalır, ada değeri çakışma kaydında saklanır.
//! Aynı değere değişmiş olsa bile çakışmadır: iki adada kapanan adisyon çift tahsilattır.
//! Para hiçbir kuralda yeniden hesaplanmaz; yalnız stok sayaçları farkla toplanır.

use super::capture::{self, RowChange};
use super::island_queue::{self, IslandBatch, IslandEntry, ISLAND_AUDIT};
use super::merge_guard::{carry_audit, reject_rollback};
use super::merge_stock;
use super::op_log::Operation;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::cari::ApplyError;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteArguments;
use sqlx::{Acquire, SqliteConnection};
use std::collections::BTreeSet;

/// Farkla birleşen stok sayaçları: iki adadaki satış ikisi de düşülmüş olmalıdır.
const COUNTERS: [(&str, &str); 2] = [
    ("inventory_batches", "remaining_quantity"),
    ("inventory_items", "current_stock"),
];

fn internal(error: impl ToString) -> ApplyError {
    ApplyError::Internal(error.to_string())
}

fn is_counter(table: &str, column: &str) -> bool {
    COUNTERS.contains(&(table, column))
}

/// Çakışma türü tabloya göre; yönetici kuyruğunda hangi düzeltme akışının gerektiğini söyler.
fn kind_for(table: &str) -> &'static str {
    match table {
        "orders" | "order_items" | "events" | "cash_movements" | "refunds" => "ORDER_CONFLICT",
        "tables" => "TABLE_CONFLICT",
        "debts" | "debt_payments" | "directories" => "BALANCE_CONFLICT",
        _ => "ROW_CONFLICT",
    }
}

fn severity(kind: &str) -> u8 {
    match kind {
        "ORDER_CONFLICT" => 6,
        "BALANCE_CONFLICT" => 5,
        "REJECTED_ON_MERGE" => 4,
        "TABLE_CONFLICT" => 3,
        "STOCK_NEGATIVE" => 2,
        "DELETED_ELSEWHERE" => 1,
        _ => 0,
    }
}

/// Ada işleminden türetilen kimlik; çakışma her cihazda aynı kimlikle yazılır.
pub(super) fn conflict_id(operation_id: &str) -> String {
    match operation_id.split_once('_') {
        Some((_, suffix)) if !suffix.is_empty() => format!("cfl_{suffix}"),
        _ => {
            let digest = hex::encode(Sha256::digest(operation_id.as_bytes()));
            format!("cfl_{}", digest[..26].to_uppercase())
        }
    }
}

pub(super) fn key_text(key: &Map<String, Value>) -> String {
    key.values()
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("/")
}

async fn current_row(
    conn: &mut SqliteConnection,
    table: &str,
    columns: &[String],
    key: &Map<String, Value>,
) -> Result<Option<Map<String, Value>>, String> {
    let mut arguments = SqliteArguments::default();
    let mut parts = Vec::with_capacity(key.len());
    for (column, value) in key {
        if !columns.contains(column) {
            return Err(format!("INTERNAL: bilinmeyen sütun: {table}.{column}"));
        }
        parts.push(format!("t.{} IS ?", capture::quoted(column)));
        capture::bind(&mut arguments, value)?;
    }
    let text: Option<String> = sqlx::query_scalar_with(
        &format!(
            "SELECT {} FROM {} AS t WHERE {}",
            capture::json_of("t", columns),
            capture::quoted(table),
            parts.join(" AND ")
        ),
        arguments,
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    text.map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .transpose()
}

fn key_for(change: &RowChange, keys: &[String]) -> Result<Map<String, Value>, String> {
    if let Some(key) = &change.key {
        return Ok(key.clone());
    }
    let row = change
        .row
        .as_ref()
        .or(change.old.as_ref())
        .ok_or_else(|| "INTERNAL: değişiklikte satır eksik".to_string())?;
    Ok(keys
        .iter()
        .filter_map(|key| row.get(key).map(|value| (key.clone(), value.clone())))
        .collect())
}

/// Stok sayacında iki tarafın düşümü toplanır: güncel + (ada − önceki). Değerlerden biri
/// sayı değilse toplama yapılmaz, sütun olağan kurala düşer ve çakışma görünür.
fn counter_sum(island: &Value, base: Option<&Value>, current: Option<&Value>) -> Option<f64> {
    let island = island.as_f64()?;
    let base = base?.as_f64()?;
    let current = current?.as_f64()?;
    Some(current + (island - base))
}

/// Birleşmenin bir satırdaki izi.
#[derive(Default)]
pub(super) struct RowOutcome {
    pub(super) conflicts: Vec<Value>,
    pub(super) touched_batch: Option<String>,
}

fn conflict(
    kind: &str,
    change: &RowChange,
    key: &Map<String, Value>,
    cluster: Option<&Map<String, Value>>,
    columns: &[String],
) -> Value {
    json!({
        "kind": kind,
        "table": change.table,
        "key": key_text(key),
        "action": change.action,
        "base": change.old,
        "island": change.row,
        "cluster": cluster,
        "columns": columns,
    })
}

/// Tek ada değişikliğini güncel satırla üç yönlü birleştirir.
async fn merge_change(
    conn: &mut SqliteConnection,
    change: &RowChange,
) -> Result<RowOutcome, String> {
    let table = change.table.as_str();
    let (columns, keys) = capture::table_shape(conn, table).await?;
    let key = key_for(change, &keys)?;
    let current = current_row(conn, table, &columns, &key).await?;
    let mut outcome = RowOutcome::default();
    if table == "inventory_batches" {
        outcome.touched_batch = key.get("id").and_then(Value::as_str).map(str::to_string);
    }
    match (change.action.as_str(), current) {
        ("I", None) => capture::apply_one(conn, change).await?,
        ("I", Some(existing)) => {
            if change.row.as_ref() != Some(&existing) {
                let all = columns.clone();
                outcome.conflicts.push(conflict(
                    "ROW_CONFLICT",
                    change,
                    &key,
                    Some(&existing),
                    &all,
                ));
            }
        }
        ("U", None) => {
            outcome
                .conflicts
                .push(conflict("DELETED_ELSEWHERE", change, &key, None, &[]))
        }
        ("U", Some(existing)) => {
            let empty = Map::new();
            let base = change.old.as_ref().unwrap_or(&empty);
            let island = change.row.as_ref().unwrap_or(&empty);
            let mut merged = Map::new();
            let mut clashing = Vec::new();
            for (column, value) in island {
                let before = base.get(column);
                if before == Some(value) {
                    continue;
                }
                let now = existing.get(column);
                let counted = is_counter(table, column)
                    .then(|| counter_sum(value, before, now))
                    .flatten();
                if let Some(sum) = counted {
                    merged.insert(column.clone(), json!(sum));
                } else if now == before {
                    merged.insert(column.clone(), value.clone());
                } else {
                    clashing.push(column.clone());
                }
            }
            if !clashing.is_empty() {
                outcome.conflicts.push(conflict(
                    kind_for(table),
                    change,
                    &key,
                    Some(&existing),
                    &clashing,
                ));
            }
            if !merged.is_empty() {
                let update = RowChange {
                    table: change.table.clone(),
                    action: "U".to_string(),
                    key: Some(key.clone()),
                    row: Some(merged),
                    old: None,
                };
                capture::apply_one(conn, &update).await?;
            }
        }
        ("D", None) => {}
        ("D", Some(existing)) => {
            if change.old.as_ref() == Some(&existing) {
                capture::apply_one(conn, change).await?;
            } else {
                let all = columns.clone();
                outcome.conflicts.push(conflict(
                    kind_for(table),
                    change,
                    &key,
                    Some(&existing),
                    &all,
                ));
            }
        }
        (other, _) => return Err(format!("INTERNAL: bilinmeyen değişiklik türü: {other}")),
    }
    Ok(outcome)
}

/// Değişikliğin dokunduğu ve onlara bağlı tablolardaki yabancı anahtar ihlali sayısı.
async fn fk_violations(
    conn: &mut SqliteConnection,
    tables: &BTreeSet<String>,
) -> Result<i64, String> {
    let mut scope = tables.clone();
    for table in tables {
        let children: Vec<String> = sqlx::query_scalar(
            "SELECT m.name FROM sqlite_master m, pragma_foreign_key_list(m.name) f
             WHERE m.type = 'table' AND f.\"table\" = ?",
        )
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        scope.extend(children);
    }
    let mut total = 0;
    for table in &scope {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check(?)")
            .bind(table)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        total += count;
    }
    Ok(total)
}

/// Tek ada işlemini birleştirir; sonucu ve çakışmaları kalıcı yazar.
async fn merge_entry(
    conn: &mut SqliteConnection,
    merge: &Operation,
    batch: &IslandBatch,
    entry: &IslandEntry,
) -> Result<Option<&'static str>, ApplyError> {
    carry_audit(conn, batch, entry).await?;
    let business: Vec<&RowChange> = entry
        .changes
        .iter()
        .filter(|c| {
            c.table != ISLAND_AUDIT
                && c.table != "audit_ledger"
                && !capture::is_origin_only(&c.table)
        })
        .collect();
    let tables: BTreeSet<String> = business.iter().map(|c| c.table.clone()).collect();
    let mut savepoint = conn.begin().await?;
    let before = fk_violations(&mut savepoint, &tables)
        .await
        .map_err(internal)?;
    let mut conflicts = Vec::new();
    let mut batches = BTreeSet::new();
    for change in &business {
        let outcome = merge_change(&mut savepoint, change)
            .await
            .map_err(internal)?;
        conflicts.extend(outcome.conflicts);
        batches.extend(outcome.touched_batch);
    }
    let after = fk_violations(&mut savepoint, &tables)
        .await
        .map_err(internal)?;
    let mut detail = Value::Null;
    let outcome = if after > before {
        savepoint.rollback().await?;
        conflicts = vec![json!({
            "kind": "REJECTED_ON_MERGE",
            "table": business.first().map(|c| c.table.clone()),
            "key": business.first().and_then(|c| c.key.as_ref()).map(key_text),
            "changes": business,
        })];
        "REJECTED"
    } else {
        let corrections = merge_stock::settle_negative(&mut savepoint, &merge.tenant_id, &batches)
            .await
            .map_err(internal)?;
        conflicts.extend(corrections.conflicts);
        if !corrections.moves.is_empty() {
            detail = json!({ "stockCorrections": corrections.moves });
        }
        savepoint.commit().await?;
        if conflicts.is_empty() {
            "CLEAN"
        } else {
            "CONFLICT"
        }
    };
    sqlx::query(
        "INSERT INTO merged_island_ops (island_operation_id, tenant_id, device_id, device_sequence,
                                        merge_operation_id, outcome, detail, merged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&entry.operation_id)
    .bind(&merge.tenant_id)
    .bind(&batch.device_id)
    .bind(entry.device_sequence)
    .bind(&merge.operation_id)
    .bind(outcome)
    .bind((!detail.is_null()).then(|| detail.to_string()))
    .bind(&merge.created_at)
    .execute(&mut *conn)
    .await?;
    let Some(main) = conflicts
        .iter()
        .max_by_key(|c| severity(c["kind"].as_str().unwrap_or("")))
    else {
        return Ok(None);
    };
    let kind = match main["kind"].as_str().unwrap_or("") {
        "ORDER_CONFLICT" => "ORDER_CONFLICT",
        "BALANCE_CONFLICT" => "BALANCE_CONFLICT",
        "REJECTED_ON_MERGE" => "REJECTED_ON_MERGE",
        "TABLE_CONFLICT" => "TABLE_CONFLICT",
        "STOCK_NEGATIVE" => "STOCK_NEGATIVE",
        "DELETED_ELSEWHERE" => "DELETED_ELSEWHERE",
        _ => "ROW_CONFLICT",
    };
    sqlx::query(
        "INSERT INTO merge_conflicts (id, tenant_id, island_operation_id, merge_operation_id,
                                      device_id, kind, target_table, target_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(conflict_id(&entry.operation_id))
    .bind(&merge.tenant_id)
    .bind(&entry.operation_id)
    .bind(&merge.operation_id)
    .bind(&batch.device_id)
    .bind(kind)
    .bind(main["table"].as_str().unwrap_or(""))
    .bind(main["key"].as_str().unwrap_or(""))
    .bind(Value::Array(conflicts.clone()).to_string())
    .bind(&merge.created_at)
    .execute(&mut *conn)
    .await?;
    Ok(Some(kind))
}

/// `ISLAND_MERGE` kaydını uygular. Çağıran `APPLY` kapısını açmıştır.
pub(super) async fn apply_merge(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    merge: &Operation,
    batch: &IslandBatch,
    device_id: &str,
) -> Result<Value, ApplyError> {
    if merge.device_id != batch.device_id {
        return Err(ApplyError::Rejected(
            "UNAUTHORIZED: birleşme yalnız kendi ada kaydını taşır".to_string(),
        ));
    }
    reject_rollback(conn, &merge.tenant_id, batch).await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *conn)
        .await?;
    let mut merged = 0;
    let mut conflicts = 0;
    let mut entries: Vec<&IslandEntry> = batch.entries.iter().collect();
    entries.sort_by_key(|entry| entry.device_sequence);
    for entry in entries {
        let known: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM merged_island_ops WHERE island_operation_id = ?")
                .bind(&entry.operation_id)
                .fetch_optional(&mut *conn)
                .await?;
        if known.is_some() {
            continue;
        }
        merged += 1;
        if merge_entry(conn, merge, batch, entry).await?.is_some() {
            conflicts += 1;
        }
    }
    let tip: Option<(i64, String)> = sqlx::query_as(
        "SELECT device_sequence, current_hash FROM audit_island_ledger
         WHERE device_id = ? ORDER BY device_sequence DESC LIMIT 1",
    )
    .bind(&batch.device_id)
    .fetch_optional(&mut *conn)
    .await?;
    let summary = json!({
        "device": batch.device_id,
        "merged": merged,
        "conflicts": conflicts,
        "islandTip": tip.as_ref().map(|(sequence, hash)| json!({ "sequence": sequence, "hash": hash })),
    });
    // Ana zincir her cihazda aynı kalır: tek kayıt, günlükteki zamanla, alt zincirin ucunu mühürler.
    let ctx = AuditContext::new(
        merge.tenant_id.clone(),
        "SYSTEM".to_string(),
        "System".to_string(),
        category::SISTEM,
        "sync:island_merged",
        merge.operation_id.clone(),
        summary.clone(),
        merge.created_at.clone(),
    )
    .map_err(ApplyError::Internal)?;
    AuditService::append(conn, audit_lock, &ctx)
        .await
        .map_err(ApplyError::Internal)?;
    if batch.device_id == device_id {
        island_queue::mark_merged(conn, &merge.tenant_id, &merge.operation_id)
            .await
            .map_err(ApplyError::Internal)?;
    }
    Ok(summary)
}
