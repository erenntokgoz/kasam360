//! Hesaptan çıkışta bu kasanın yerel verisinin ve lisansının silinmesi.
//!
//! Asıl kayıt buluttadır; yerel kopya ancak bulut bu kasanın bütün işlemlerini
//! aldığını doğruladıktan (`release` → `safeToWipe`) sonra silinir. Doğrulama yoksa,
//! ağ yoksa veya gönderilmemiş işlem varsa hiçbir satır silinmez (fail-closed);
//! bekleyen silme işareti kalır ve internet gelince tamamlanır. Şema kalır.
//!
//! Denetim defteri bu kasada da eklemeli kalır; boşaltma yalnız bu yolda, bulutun
//! kabulünden sonra ve aynı transaction'da kilit tetikleyicisi geri kurularak yapılır.
//! Diğer kasaların verisi bulutta ve kendi diskindedir, etkilenmez.

use super::api::{ApiError, CloudApi, Credentials};
use super::state::{self, Identity};
use super::SyncError;
use crate::services::lan_sync::{capture, pairing, store};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection, SqlitePool};

/// Kiracı kolonu taşımayan, bu cihaza ait oturum ve durum tabloları.
const DEVICE_TABLES: [&str; 8] = [
    "sessions",
    "login_attempts",
    "approval_attempts",
    "two_factor_verifications",
    "snapshots",
    "conflict_log",
    "device_session",
    "local_device_identity",
];

/// Üst tablodan süzülen alt tablolar; üst tablo silinmeden önce boşaltılır.
const CHILD_TABLES: [&str; 2] = ["modifier_options", "product_modifier_groups"];

/// Tek zincir: kiracıdan bağımsız bütün satırlar aynı özet zincirindedir.
const CHAIN_TABLES: [&str; 2] = ["audit_ledger", "audit_island_ledger"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseOutcome {
    pub wiped: bool,
    pub pending: i64,
    pub code: Option<String>,
}

fn local(error: impl ToString) -> SyncError {
    SyncError::Local(error.to_string())
}

fn kept(pending: i64, code: &str) -> ReleaseOutcome {
    ReleaseOutcome {
        wiped: false,
        pending,
        code: Some(code.to_string()),
    }
}

async fn columns(conn: &mut SqliteConnection, table: &str) -> Result<Vec<String>, SyncError> {
    sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(local)
}

async fn parents(conn: &mut SqliteConnection, table: &str) -> Result<Vec<String>, SyncError> {
    sqlx::query_scalar("SELECT DISTINCT \"table\" FROM pragma_foreign_key_list(?)")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(local)
}

/// Silinecek tablolar, çocuktan üste: `ON DELETE RESTRICT` ertelenmez, sıra önemlidir.
async fn wipe_order(conn: &mut SqliteConnection) -> Result<Vec<String>, SyncError> {
    let mut tables: Vec<String> = pairing::replicated_tables(conn).await.map_err(local)?;
    let origin_only: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
         ('approvals', 'email_queue', 'outbox', 'whatsapp_queue')",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(local)?;
    tables.extend(
        origin_only
            .into_iter()
            .filter(|table| capture::is_origin_only(table)),
    );
    let sync_tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sync\\_%' ESCAPE '\\'
         AND name NOT IN ('sync_device_key', 'sync_write_gate')",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(local)?;
    tables.extend(sync_tables);
    for table in DEVICE_TABLES {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut *conn)
        .await
        .map_err(local)?;
        if exists > 0 {
            tables.push(table.to_string());
        }
    }
    tables.sort();
    tables.dedup();
    let mut graph = Vec::with_capacity(tables.len());
    for table in &tables {
        graph.push((table.clone(), parents(conn, table).await?));
    }
    let mut ordered: Vec<String> = CHILD_TABLES
        .iter()
        .filter(|table| tables.iter().any(|name| name == *table))
        .map(|table| table.to_string())
        .collect();
    let mut remaining: Vec<(String, Vec<String>)> = graph
        .into_iter()
        .filter(|(table, _)| !ordered.contains(table))
        .collect();
    while !remaining.is_empty() {
        let referenced = |name: &str, rest: &[(String, Vec<String>)]| {
            rest.iter()
                .any(|(other, parents)| other != name && parents.iter().any(|p| p == name))
        };
        // Döngüde ertelenmiş denetim yeter; ilk tablo alınır.
        let index = (0..remaining.len())
            .find(|&i| !referenced(&remaining[i].0, &remaining))
            .unwrap_or(0);
        ordered.push(remaining.remove(index).0);
    }
    Ok(ordered)
}

/// Tablo süzgeci. Kiracısız silme yalnız cihaza ait tablolarda ve tek zincirde yapılır.
fn filter_for(table: &str, columns: &[String]) -> Result<Option<&'static str>, SyncError> {
    if CHAIN_TABLES.contains(&table) {
        return Ok(None);
    }
    if columns.iter().any(|column| column == "tenant_id") {
        return Ok(Some("tenant_id = ?"));
    }
    if table == "tenants" {
        return Ok(Some("id = ?"));
    }
    if CHILD_TABLES.contains(&table) {
        return Ok(Some(
            "group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = ?)",
        ));
    }
    if DEVICE_TABLES.contains(&table) || table.starts_with("sync_") {
        return Ok(None);
    }
    Err(SyncError::Permanent {
        code: "CLOUD_WIPE_UNKNOWN_TABLE".to_string(),
        message: format!("{table} tablosunun kime ait olduğu belirlenemedi; silme yapılmadı."),
    })
}

async fn delete_table(
    conn: &mut SqliteConnection,
    table: &str,
    tenant_id: &str,
) -> Result<(), SyncError> {
    let columns = columns(conn, table).await?;
    let filter = filter_for(table, &columns)?;
    // Silme kilidi yalnız bu transaction içinde kalkar ve aynı tanımla geri kurulur.
    let locks = sqlx::query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?
         AND sql LIKE '%BEFORE DELETE%' AND name NOT LIKE 'sync\\_cap\\_%' ESCAPE '\\'",
    )
    .bind(table)
    .fetch_all(&mut *conn)
    .await
    .map_err(local)?;
    let mut saved = Vec::with_capacity(locks.len());
    for lock in locks {
        let name: String = lock.try_get("name").map_err(local)?;
        let sql: String = lock.try_get("sql").map_err(local)?;
        sqlx::query(&format!("DROP TRIGGER \"{}\"", name.replace('"', "\"\"")))
            .execute(&mut *conn)
            .await
            .map_err(local)?;
        saved.push(sql);
    }
    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    let deleted = match filter {
        Some(filter) => {
            sqlx::query(&format!("DELETE FROM {quoted} WHERE {filter}"))
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
        }
        None => {
            sqlx::query(&format!("DELETE FROM {quoted}"))
                .execute(&mut *conn)
                .await
        }
    };
    deleted.map_err(|e| local(format!("{table}: {e}")))?;
    for sql in saved {
        sqlx::query(&sql).execute(&mut *conn).await.map_err(local)?;
    }
    Ok(())
}

/// Bekleyen silme hâlâ geçerliyse veriyi siler. Arada hesaba yeniden girilmiş ya da yeni
/// işlem yazılmışsa silinmez: kontrol silmeyle aynı kilit altındadır.
pub async fn wipe(pool: &SqlitePool, identity: &Identity) -> Result<bool, SyncError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(local)?;
    let current = state::load(&mut tx).await.map_err(local)?;
    let signed_in: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM device_session WHERE user_id IS NOT NULL")
            .fetch_one(&mut *tx)
            .await
            .map_err(local)?;
    let pending = state::pending_count(&mut tx, identity)
        .await
        .map_err(local)?;
    if !current.wipe_pending || signed_in > 0 || pending > 0 {
        return Ok(false);
    }
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    // Kapı açıkken silme yakalanmaz; yakalanan silme buluta "işletme silindi" diye giderdi.
    sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('APPLY')")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    for table in wipe_order(&mut tx).await? {
        delete_table(&mut tx, &table, &identity.tenant_id).await?;
    }
    sqlx::query("DELETE FROM sync_write_gate")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    // Kurulum başa döner: sonraki giriş buluttan geri yükler.
    sqlx::query("DELETE FROM app_setup WHERE slot = 1")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    sqlx::query("INSERT INTO app_setup (slot, status) VALUES (1, 'PENDING')")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    // Lisans cihaz kimliği kalır: aynı kurulum cihaz limitinde ikinci kez sayılmaz.
    sqlx::query(
        "UPDATE device_license SET license_key = NULL, token = NULL, checked_at = NULL,
                last_error = NULL WHERE slot = 1",
    )
    .execute(&mut *tx)
    .await
    .map_err(local)?;
    tx.commit().await.map_err(local)?;
    Ok(true)
}

/// Yerel ağ kümesinin üyesi tek başına silinemez: üyelik kayıtlı kalır, çoğunluk bozulur.
async fn shared_cluster(conn: &mut SqliteConnection) -> Result<bool, SyncError> {
    let Some(row) = store::load_cluster(conn).await.map_err(local)? else {
        return Ok(false);
    };
    Ok(store::current_members(conn, &row)
        .await
        .map_err(local)?
        .len()
        > 1)
}

/// Bulut onayı alınırsa siler; alınamazsa veriyi ve bekleyen işlemleri korur.
pub async fn release_and_wipe<A: CloudApi>(
    pool: &SqlitePool,
    api: &A,
    credentials: &Credentials,
    identity: &Identity,
) -> Result<ReleaseOutcome, SyncError> {
    let (pending, count, last, clustered) = {
        let mut conn = pool.acquire().await.map_err(local)?;
        let pending = state::pending_count(&mut conn, identity)
            .await
            .map_err(local)?;
        let (count, last) = state::own_operations(&mut conn, identity)
            .await
            .map_err(local)?;
        (pending, count, last, shared_cluster(&mut conn).await?)
    };
    if clustered {
        return Ok(kept(pending, "CLUSTER_MEMBER"));
    }
    if pending > 0 {
        return Ok(kept(pending, "PENDING_OPERATIONS"));
    }
    let body = json!({
        "tenantId": identity.tenant_id,
        "originDeviceId": identity.device_id,
        "lastOperationId": last,
        "operationCount": count,
    })
    .to_string();
    match api.release(credentials, body).await {
        Ok(reply) if reply.get("safeToWipe").and_then(Value::as_bool) == Some(true) => {
            if wipe(pool, identity).await? {
                return Ok(ReleaseOutcome {
                    wiped: true,
                    pending: 0,
                    code: None,
                });
            }
            Ok(kept(0, "WIPE_CANCELLED"))
        }
        Ok(_) => Ok(kept(pending, "PENDING_OPERATIONS")),
        Err(ApiError::Rejected { code, .. }) if code == "PENDING_OPERATIONS" => {
            Ok(kept(pending, "PENDING_OPERATIONS"))
        }
        Err(error) => Err(super::outbox::classify(error)),
    }
}
