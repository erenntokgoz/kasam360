//! Satır değişikliklerini yakalar ve her cihazda aynı sırayla uygular.
//!
//! Neden komut yerine satır: yazma komutları saat ve rastgele kimlik ürettiği için
//! başka cihazda yeniden çalıştırmak farklı sonuç verirdi. Satır görüntüsü her
//! cihazda aynı sonucu verir, denetim zinciri dahil.
//!
//! Tetikleyiciler yalnız çok cihazlı kurulumda vardır; tek cihazın yazma yolu ve hızı
//! değişmez. Kapıdan geçmeyen yazmayı tetikleyici durdurur: bir yazma yolu unutulursa
//! cihazlar sessizce ayrışmak yerine hata görünür.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::sqlite::SqliteArguments;
use sqlx::{Arguments, Row, SqliteConnection};

const TRIGGER_PREFIX: &str = "sync_cap_";
const GUARD_MESSAGE: &str = "SYNC_UNSUPPORTED: bu yazma çok cihazlı eşitlemeden geçmiyor";

/// Yerel kalan ama işlemle birlikte yazılan tablolar. Tahsilat geri alınınca bunlar da
/// geri gider; yalnız işlemi başlatan cihazda yeniden yazılır. Onay jetonu ve dış teslim
/// kuyruğu başka cihaza taşınsaydı jeton iki yerde geçerli olur, ileti iki kez giderdi.
const ORIGIN_ONLY: [&str; 4] = ["approvals", "email_queue", "outbox", "whatsapp_queue"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RowChange {
    pub table: String,
    /// `I`, `U` veya `D`.
    pub action: String,
    pub key: Option<Map<String, Value>>,
    pub row: Option<Map<String, Value>>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Şemadan okunur: iletideki ad veya sütun doğrudan SQL'e girmez.
async fn table_shape(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<(Vec<String>, Vec<String>), String> {
    let rows = sqlx::query("SELECT name, pk FROM pragma_table_info(?) ORDER BY cid")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(text_error)?;
    let mut columns = Vec::with_capacity(rows.len());
    let mut keys: Vec<(i64, String)> = Vec::new();
    for row in rows {
        let name: String = row.try_get("name").map_err(text_error)?;
        let order: i64 = row.try_get("pk").map_err(text_error)?;
        if order > 0 {
            keys.push((order, name.clone()));
        }
        columns.push(name);
    }
    keys.sort();
    Ok((columns, keys.into_iter().map(|(_, name)| name).collect()))
}

fn json_of(alias: &str, columns: &[String]) -> String {
    let pairs: Vec<String> = columns
        .iter()
        .map(|column| format!("{}, {alias}.{}", sql_text(column), quoted(column)))
        .collect();
    format!("json_object({})", pairs.join(", "))
}

async fn drop_triggers(conn: &mut SqliteConnection) -> Result<(), String> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_cap\\_%' ESCAPE '\\'",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    for name in names {
        sqlx::query(&format!("DROP TRIGGER {}", quoted(&name)))
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
    }
    Ok(())
}

async fn create_triggers(
    conn: &mut SqliteConnection,
    table: &str,
    origin_only: bool,
) -> Result<(), String> {
    let (columns, keys) = table_shape(conn, table).await?;
    if keys.is_empty() {
        return Err(format!(
            "INTERNAL: birincil anahtarsız tablo eşitlenemez: {table}"
        ));
    }
    let guard = if origin_only {
        String::new()
    } else {
        format!(
            "SELECT RAISE(ABORT, {}) WHERE NOT EXISTS (SELECT 1 FROM sync_write_gate);",
            sql_text(GUARD_MESSAGE)
        )
    };
    let capturing = "WHERE EXISTS (SELECT 1 FROM sync_write_gate WHERE mode = 'CAPTURE')";
    let name = sql_text(table);
    let events = [
        (
            "i",
            "INSERT",
            "'I'",
            "NULL".to_string(),
            json_of("NEW", &columns),
        ),
        (
            "u",
            "UPDATE",
            "'U'",
            json_of("OLD", &keys),
            json_of("NEW", &columns),
        ),
        (
            "d",
            "DELETE",
            "'D'",
            json_of("OLD", &keys),
            "NULL".to_string(),
        ),
    ];
    for (suffix, event, action, key, data) in events {
        let statement = format!(
            "CREATE TRIGGER {trigger} AFTER {event} ON {target} BEGIN {guard}
                 INSERT INTO sync_capture (table_name, action, row_key, row_data)
                 SELECT {name}, {action}, {key}, {data} {capturing};
             END",
            trigger = quoted(&format!("{TRIGGER_PREFIX}{table}_{suffix}")),
            target = quoted(table),
        );
        sqlx::query(&statement)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("Eşitleme tetikleyicisi kurulamadı ({table}): {e}"))?;
    }
    Ok(())
}

/// Kapıyı kurar veya kaldırır. Şema değişmiş olabilir, bu yüzden her seferinde yeniden
/// üretilir.
pub async fn sync_triggers(conn: &mut SqliteConnection, enabled: bool) -> Result<(), String> {
    drop_triggers(conn).await?;
    if !enabled {
        return Ok(());
    }
    for table in super::pairing::replicated_tables(conn).await? {
        create_triggers(conn, &table, false).await?;
    }
    for table in ORIGIN_ONLY {
        create_triggers(conn, table, true).await?;
    }
    Ok(())
}

/// Transaction'ın yakaladığı değişiklikler, yazıldıkları sırayla.
pub async fn read_capture(conn: &mut SqliteConnection) -> Result<Vec<RowChange>, String> {
    let rows =
        sqlx::query("SELECT table_name, action, row_key, row_data FROM sync_capture ORDER BY seq")
            .fetch_all(&mut *conn)
            .await
            .map_err(text_error)?;
    let parse = |text: Option<String>| -> Result<Option<Map<String, Value>>, String> {
        text.map(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
            .transpose()
    };
    rows.iter()
        .map(|row| {
            Ok(RowChange {
                table: row.try_get("table_name").map_err(text_error)?,
                action: row.try_get("action").map_err(text_error)?,
                key: parse(row.try_get("row_key").map_err(text_error)?)?,
                row: parse(row.try_get("row_data").map_err(text_error)?)?,
            })
        })
        .collect()
}

fn bind(arguments: &mut SqliteArguments<'_>, value: &Value) -> Result<(), String> {
    let added = match value {
        Value::Null => arguments.add(Option::<String>::None),
        Value::Bool(flag) => arguments.add(i64::from(*flag)),
        Value::Number(number) => match number.as_i64() {
            Some(integer) => arguments.add(integer),
            None => arguments.add(number.as_f64().unwrap_or_default()),
        },
        Value::String(text) => arguments.add(text.clone()),
        other => arguments.add(other.to_string()),
    };
    added.map_err(|e| e.to_string())
}

fn known_columns<'a>(
    table: &str,
    columns: &[String],
    values: &'a Map<String, Value>,
) -> Result<Vec<(&'a String, &'a Value)>, String> {
    values
        .iter()
        .map(|(column, value)| {
            if columns.contains(column) {
                Ok((column, value))
            } else {
                Err(format!("INTERNAL: bilinmeyen sütun: {table}.{column}"))
            }
        })
        .collect()
}

async fn apply_one(conn: &mut SqliteConnection, change: &RowChange) -> Result<(), String> {
    let (columns, keys) = table_shape(conn, &change.table).await?;
    let table = quoted(&change.table);
    let mut arguments = SqliteArguments::default();
    let key_filter = |arguments: &mut SqliteArguments<'_>| -> Result<String, String> {
        let key = change
            .key
            .as_ref()
            .ok_or_else(|| "INTERNAL: değişiklikte anahtar eksik".to_string())?;
        let mut parts = Vec::new();
        for (column, value) in known_columns(&change.table, &columns, key)? {
            parts.push(format!("{} IS ?", quoted(column)));
            bind(arguments, value)?;
        }
        if parts.is_empty() {
            return Err("INTERNAL: değişiklik anahtarı boş".to_string());
        }
        Ok(parts.join(" AND "))
    };
    let statement = match change.action.as_str() {
        "D" => format!("DELETE FROM {table} WHERE {}", key_filter(&mut arguments)?),
        "U" => {
            let row = change
                .row
                .as_ref()
                .ok_or_else(|| "INTERNAL: güncellemede satır eksik".to_string())?;
            let mut sets = Vec::new();
            for (column, value) in known_columns(&change.table, &columns, row)? {
                sets.push(format!("{} = ?", quoted(column)));
                bind(&mut arguments, value)?;
            }
            let filter = key_filter(&mut arguments)?;
            format!("UPDATE {table} SET {} WHERE {filter}", sets.join(", "))
        }
        "I" => {
            let row = change
                .row
                .as_ref()
                .ok_or_else(|| "INTERNAL: eklemede satır eksik".to_string())?;
            let mut names = Vec::new();
            for (column, value) in known_columns(&change.table, &columns, row)? {
                names.push(quoted(column));
                bind(&mut arguments, value)?;
            }
            // `OR REPLACE` kullanılmaz: var olan satırı silmek bağlı kayıtları düşürürdü.
            let conflict: Vec<String> = keys.iter().map(|key| quoted(key)).collect();
            let updates: Vec<String> = names
                .iter()
                .filter(|name| !conflict.contains(name))
                .map(|name| format!("{name} = excluded.{name}"))
                .collect();
            let action = if updates.is_empty() {
                "NOTHING".to_string()
            } else {
                format!("UPDATE SET {}", updates.join(", "))
            };
            format!(
                "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT({}) DO {action}",
                names.join(", "),
                vec!["?"; names.len()].join(", "),
                conflict.join(", "),
            )
        }
        other => return Err(format!("INTERNAL: bilinmeyen değişiklik türü: {other}")),
    };
    sqlx::query_with(&statement, arguments)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("{}: {e}", change.table))?;
    Ok(())
}

/// Değişiklikleri uygular. Yerel kalması gereken tablolara yazan ileti reddedilir:
/// eşitleme durumu ağdan gelen satırla değiştirilemez.
pub async fn apply_changes(
    conn: &mut SqliteConnection,
    changes: &[RowChange],
    from_this_device: bool,
) -> Result<(), String> {
    let replicated = super::pairing::replicated_tables(conn).await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    for change in changes {
        if ORIGIN_ONLY.contains(&change.table.as_str()) {
            if from_this_device {
                apply_one(conn, change).await?;
            }
            continue;
        }
        if !replicated.contains(&change.table) {
            return Err(format!("INTERNAL: eşitlenmeyen tablo: {}", change.table));
        }
        apply_one(conn, change).await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;
