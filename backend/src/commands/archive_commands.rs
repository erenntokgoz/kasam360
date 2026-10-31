//! Kaldırılan yasal modülün kayıtları için salt okunur arşiv.
//!
//! Modül üründen çıktı ama işletmenin girdiği ruhsat, poliçe ve lisans kayıtları
//! silinmedi: tablolar yerinde durur, yedeğe girer. Sahip kaydı buradan dosya olarak
//! alabilir; böylece veri sessizce kaybolmaz ve kimse yeniden düzenleyemez.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, SqliteConnection, TypeInfo, ValueRef};
use tauri::State;

use crate::commands::command_helpers::require_tenant_id;
use crate::db::DbPool;
use crate::rbac::{self, Role};

/// Sabit liste: tablo adı sorguya kullanıcı girdisinden girmez.
const TABLES: [&str; 4] = [
    "legal_documents",
    "insurance_policies",
    "music_licenses",
    "legal_attachments",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveStatus {
    pub record_count: i64,
}

async fn count_records(conn: &mut SqliteConnection, tenant_id: &str) -> Result<i64, String> {
    let mut total = 0;
    for table in TABLES {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE tenant_id = ?"))
                .bind(tenant_id)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        total += count;
    }
    Ok(total)
}

fn row_json(row: &SqliteRow) -> Result<Value, String> {
    let mut object = serde_json::Map::new();
    for column in row.columns() {
        let name = column.name();
        let raw = row.try_get_raw(name).map_err(|e| e.to_string())?;
        let value = if raw.is_null() {
            Value::Null
        } else if raw.type_info().name() == "INTEGER" {
            json!(row.try_get::<i64, _>(name).map_err(|e| e.to_string())?)
        } else {
            json!(row.try_get::<String, _>(name).map_err(|e| e.to_string())?)
        };
        object.insert(name.to_string(), value);
    }
    Ok(Value::Object(object))
}

pub(crate) async fn build_archive(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Value, String> {
    let mut archive = serde_json::Map::new();
    for table in TABLES {
        let rows = sqlx::query(&format!("SELECT * FROM {table} WHERE tenant_id = ?"))
            .bind(tenant_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        let items = rows.iter().map(row_json).collect::<Result<Vec<_>, _>>()?;
        archive.insert(table.to_string(), Value::Array(items));
    }
    Ok(Value::Object(archive))
}

#[tauri::command]
pub async fn get_legacy_archive_status(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<LegacyArchiveStatus, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    Ok(LegacyArchiveStatus {
        record_count: count_records(&mut conn, &tenant_id).await?,
    })
}

#[tauri::command]
pub async fn export_legacy_archive(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Value, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let tenant_id = require_tenant_id(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    build_archive(&mut conn, &tenant_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn arsiv_kayitlari_silmeden_yalniz_kendi_kiracisini_dondurur() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema");
        sqlx::raw_sql(
            "INSERT INTO legal_documents (id, tenant_id, doc_type, title, expiry_date, reminder_days)
                VALUES ('doc_1', 'tnt_a', 'RUHSAT', 'Ruhsat', '2027-01-01', 30),
                       ('doc_2', 'tnt_b', 'RUHSAT', 'Diğer', '2027-01-01', 30);",
        )
        .execute(&pool)
        .await
        .expect("kayıt");
        let mut conn = pool.acquire().await.expect("bağlantı");
        assert_eq!(count_records(&mut conn, "tnt_a").await.expect("sayım"), 1);
        let archive = build_archive(&mut conn, "tnt_a").await.expect("arşiv");
        assert_eq!(archive["legal_documents"][0]["title"], "Ruhsat");
        assert_eq!(archive["legal_documents"].as_array().map(Vec::len), Some(1));
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM legal_documents")
            .fetch_one(&mut *conn)
            .await
            .expect("sayım");
        assert_eq!(left, 2);
    }
}
