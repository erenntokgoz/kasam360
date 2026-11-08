//! Girişte geri yükleme: işletmenin bulut kopyası boş kasaya indirilir.
//!
//! Sayfalar önce belleğe alınır, sonra tek transaction'da yazılır: bağlantı yarıda
//! koparsa kasada yarım işletme kalmaz, giriş yeniden denenir. Yazma `APPLY` kapısı
//! altındadır; indirilen satırlar yeniden yakalanıp buluta geri gönderilmez.

use super::api::{CloudApi, Credentials};
use super::inbox;
use super::state;
use super::SyncError;
use crate::services::device_identity::ensure_local_device;
use crate::services::lan_sync::capture::{self, RowChange};
use crate::services::lan_sync::local_log;
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{Row, SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

const SNAPSHOT_LIMIT: i64 = 1000;
const WRITE_CHUNK: usize = 1000;
const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProgress {
    /// `DOWNLOADING`, `WRITING` veya `DONE`.
    pub phase: &'static str,
    pub rows: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub restored: bool,
    pub tenant_id: Option<String>,
    pub rows: usize,
    /// Yerel zincire bağlanamayan denetim satırları; bulutta kalırlar.
    pub skipped_audit_rows: usize,
}

fn local(error: impl ToString) -> SyncError {
    SyncError::Local(error.to_string())
}

/// Yalnız boş kasaya geri yüklenir: dolu kasanın defteri buluttakiyle birleştirilmez.
async fn require_empty(conn: &mut SqliteConnection) -> Result<(), SyncError> {
    for table in ["users", "orders", "audit_ledger", "sync_operations"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut *conn)
            .await
            .map_err(local)?;
        if count > 0 {
            return Err(SyncError::Permanent {
                code: "CLOUD_RESTORE_NOT_EMPTY".to_string(),
                message: format!("Bu kasada kayıt var ({table}); bulut verisi üzerine yazılmaz."),
            });
        }
    }
    Ok(())
}

struct Snapshot {
    tenant_id: String,
    as_of: i64,
    rows: Vec<Value>,
}

async fn download<A: CloudApi>(
    api: &A,
    credentials: &Credentials,
    progress: &(dyn Fn(RestoreProgress) + Send + Sync),
) -> Result<Option<Snapshot>, SyncError> {
    let mut rows = Vec::new();
    let mut as_of: Option<i64> = None;
    let mut tenant: Option<String> = None;
    let mut cursor: Option<String> = None;
    loop {
        let page = api
            .snapshot(credentials, as_of, cursor.clone(), SNAPSHOT_LIMIT)
            .await
            .map_err(super::outbox::classify)?;
        let page_tenant = page
            .get("tenantId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let Some(page_tenant) = page_tenant else {
            return Ok(None);
        };
        if page_tenant != credentials.tenant_id {
            return Err(local(
                "CLOUD_PROTOCOL: anlık görüntü lisans işletmesiyle eşleşmiyor",
            ));
        }
        if tenant.as_ref().is_some_and(|known| known != &page_tenant) {
            return Err(local(
                "CLOUD_PROTOCOL: anlık görüntü sayfaları farklı işletmeden",
            ));
        }
        tenant = Some(page_tenant);
        let page_as_of = page
            .get("asOfSeq")
            .and_then(Value::as_i64)
            .ok_or_else(|| local("CLOUD_PROTOCOL: anlık görüntü sırası yok"))?;
        as_of = Some(page_as_of);
        if let Some(items) = page.get("rows").and_then(Value::as_array) {
            rows.extend(items.iter().cloned());
        }
        progress(RestoreProgress {
            phase: "DOWNLOADING",
            rows: rows.len(),
        });
        cursor = page.get("next").and_then(Value::as_str).map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    match (tenant, as_of) {
        (Some(tenant_id), Some(as_of)) => Ok(Some(Snapshot {
            tenant_id,
            as_of,
            rows,
        })),
        _ => Ok(None),
    }
}

fn to_change(item: &Value) -> Result<RowChange, SyncError> {
    let table = item
        .get("table")
        .and_then(Value::as_str)
        .ok_or_else(|| local("CLOUD_PROTOCOL: satırın tablosu yok"))?;
    let object = |name: &str| item.get(name).and_then(Value::as_object).cloned();
    Ok(RowChange {
        table: table.to_string(),
        action: "I".to_string(),
        key: object("key"),
        row: Some(object("row").ok_or_else(|| local("CLOUD_PROTOCOL: satır gövdesi yok"))?),
        old: None,
    })
}

fn text_of(row: &Map<String, Value>, column: &str) -> String {
    row.get(column)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Denetim zincirini sıfır özetten başlayarak bağ bağ kurar. Bulutta farklı kasaların
/// zincirleri yan yana durabilir; yerel tetikleyici yalnız tek zinciri kabul eder.
/// Bağlanamayan satır atılmaz, bulutta kalır; sayısı sonuçta bildirilir.
fn chain_order(
    rows: Vec<RowChange>,
    sequence: &str,
    group: Option<&str>,
) -> (Vec<RowChange>, usize) {
    let total = rows.len();
    let mut groups: HashMap<String, HashMap<String, Vec<RowChange>>> = HashMap::new();
    for change in rows {
        let Some(row) = change.row.as_ref() else {
            continue;
        };
        let group_key = group.map(|column| text_of(row, column)).unwrap_or_default();
        let previous = text_of(row, "previous_hash");
        groups
            .entry(group_key)
            .or_default()
            .entry(previous)
            .or_default()
            .push(change);
    }
    let mut ordered = Vec::with_capacity(total);
    for (_, mut by_previous) in groups {
        let mut tip = ZERO_HASH.to_string();
        let mut expected = 1;
        while let Some(candidates) = by_previous.get_mut(&tip) {
            candidates.sort_by_key(|change| change.row.as_ref().map(|row| text_of(row, "id")));
            let position = candidates.iter().position(|change| {
                change
                    .row
                    .as_ref()
                    .and_then(|row| row.get(sequence))
                    .and_then(Value::as_i64)
                    == Some(expected)
            });
            let Some(position) = position else {
                break;
            };
            let next = candidates.remove(position);
            tip = next
                .row
                .as_ref()
                .map(|row| text_of(row, "current_hash"))
                .unwrap_or_default();
            expected += 1;
            ordered.push(next);
        }
    }
    let skipped = total - ordered.len();
    (ordered, skipped)
}

async fn write_chunks(
    conn: &mut SqliteConnection,
    changes: &[RowChange],
    progress: &(dyn Fn(RestoreProgress) + Send + Sync),
    written: &mut usize,
) -> Result<(), SyncError> {
    for chunk in changes.chunks(WRITE_CHUNK) {
        capture::apply_changes(conn, chunk, false)
            .await
            .map_err(local)?;
        *written += chunk.len();
        progress(RestoreProgress {
            phase: "WRITING",
            rows: *written,
        });
    }
    Ok(())
}

/// Kurulumu buluttaki işletmeyle kapatır; sihirbaz satırı yoksa açılır.
async fn mark_setup(conn: &mut SqliteConnection, tenant_id: &str) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO app_setup (slot, status) VALUES (1, 'PENDING') ON CONFLICT(slot) DO NOTHING",
    )
    .execute(&mut *conn)
    .await
    .map_err(local)?;
    crate::services::setup::mark_joined(conn, tenant_id)
        .await
        .map_err(local)
}

/// Hesabın e-postası indirilen işletmede sahip veya müdürse cihaz oturumu açılır.
async fn sign_in(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    email: Option<&str>,
) -> Result<bool, SyncError> {
    let Some(email) = email else {
        return Ok(false);
    };
    let user = sqlx::query(
        "SELECT id FROM users WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND is_active = 1
         AND role IN ('OWNER', 'MANAGER')",
    )
    .bind(tenant_id)
    .bind(email)
    .fetch_optional(&mut *conn)
    .await
    .map_err(local)?;
    let Some(user) = user else {
        return Ok(false);
    };
    let user_id: String = user.try_get("id").map_err(local)?;
    crate::services::device_session::sign_in(conn, &user_id, tenant_id)
        .await
        .map_err(local)?;
    Ok(true)
}

async fn write_snapshot(
    pool: &SqlitePool,
    snapshot: &Snapshot,
    email: Option<&str>,
    progress: &(dyn Fn(RestoreProgress) + Send + Sync),
) -> Result<usize, SyncError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(local)?;
    require_empty(&mut tx).await?;
    let mut plain = Vec::new();
    let mut ledger = Vec::new();
    let mut island = Vec::new();
    for item in &snapshot.rows {
        let change = to_change(item)?;
        match change.table.as_str() {
            "audit_ledger" => ledger.push(change),
            "audit_island_ledger" => island.push(change),
            _ => plain.push(change),
        }
    }
    let (ledger, skipped_ledger) = chain_order(ledger, "sequence", None);
    let (island, skipped_island) = chain_order(island, "device_sequence", Some("device_id"));
    sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('APPLY')")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    let mut written = 0;
    write_chunks(&mut tx, &plain, progress, &mut written).await?;
    write_chunks(&mut tx, &ledger, progress, &mut written).await?;
    write_chunks(&mut tx, &island, progress, &mut written).await?;
    sqlx::query("DELETE FROM sync_write_gate")
        .execute(&mut *tx)
        .await
        .map_err(local)?;
    mark_setup(&mut tx, &snapshot.tenant_id).await?;
    // Bu kasanın cihaz kaydı yeni açılır ve günlüğe girer: buluta da kendi işlemiyle gider.
    ensure_local_device(&mut tx, &snapshot.tenant_id)
        .await
        .map_err(local)?;
    local_log::flush(&mut tx).await.map_err(local)?;
    super::baseline::skip(&mut tx).await.map_err(local)?;
    state::set_wipe_pending(&mut tx, false)
        .await
        .map_err(local)?;
    state::save_pull_after(&mut tx, snapshot.as_of)
        .await
        .map_err(local)?;
    sign_in(&mut tx, &snapshot.tenant_id, email).await?;
    tx.commit().await.map_err(local)?;
    Ok(skipped_ledger + skipped_island)
}

/// Boş kasaya bulut verisini indirir, sonra anlık görüntüden sonraki işlemleri uygular.
/// Hesap henüz işletmeye bağlı değilse geri yüklenecek bir şey yoktur.
pub async fn restore<A: CloudApi>(
    pool: &SqlitePool,
    audit_mutex: &Arc<tokio::sync::Mutex<()>>,
    api: &A,
    credentials: &Credentials,
    email: Option<&str>,
    progress: &(dyn Fn(RestoreProgress) + Send + Sync),
) -> Result<RestoreOutcome, SyncError> {
    {
        let mut conn = pool.acquire().await.map_err(local)?;
        require_empty(&mut conn).await?;
    }
    let Some(snapshot) = download(api, credentials, progress).await? else {
        return Ok(RestoreOutcome {
            restored: false,
            tenant_id: None,
            rows: 0,
            skipped_audit_rows: 0,
        });
    };
    // Kullanıcısı olmayan anlık görüntü (ör. web'de açılmış, henüz kasa verisi olmayan işletme)
    // kurulmuş kasa sayılırsa kimse giriş yapamaz; indirilecek veri yok kabul edilir.
    let has_users = snapshot
        .rows
        .iter()
        .any(|row| row.get("table").and_then(Value::as_str) == Some("users"));
    if !has_users {
        return Ok(RestoreOutcome {
            restored: false,
            tenant_id: None,
            rows: 0,
            skipped_audit_rows: 0,
        });
    }
    let skipped = write_snapshot(pool, &snapshot, email, progress).await?;
    let identity = {
        let mut conn = pool.acquire().await.map_err(local)?;
        state::identity(&mut conn)
            .await
            .map_err(local)?
            .ok_or_else(|| local("UNCONFIGURED: yerel cihaz kimliği açılamadı"))?
    };
    inbox::pull_all(pool, audit_mutex, api, credentials, &identity).await?;
    progress(RestoreProgress {
        phase: "DONE",
        rows: snapshot.rows.len(),
    });
    Ok(RestoreOutcome {
        restored: true,
        tenant_id: Some(snapshot.tenant_id),
        rows: snapshot.rows.len(),
        skipped_audit_rows: skipped,
    })
}
