//! Küme durumunun kalıcı okunması ve yazılması.
//!
//! Dönem, oy ve onay konumu ağ yanıtından önce diske yazılır. Yeniden başlayan
//! cihaz verdiği oyu ya da onayladığı işlemi unutursa aynı dönemde iki otorite
//! oluşabilir; bu yüzden bu durum bellekte tutulmaz.

use super::op_log::{self, LogOp, Operation};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub device_id: String,
    pub name: String,
    /// Ed25519 açık anahtarı; günlükte gizli anahtar taşınmaz.
    pub public_key: String,
    /// Son bilinen `ip:port`; yalnız bağlantı ipucudur, kimlik sayılmaz.
    #[serde(default)]
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub index: i64,
    pub term: i64,
    pub operation: Operation,
}

#[derive(Debug, Clone)]
pub struct ClusterRow {
    pub tenant_id: String,
    pub cluster_id: String,
    pub term: i64,
    pub voted_for: Option<String>,
    pub commit_index: i64,
    /// Anlık görüntünün kapsadığı son konum; altı günlükten taşınmaz.
    pub base_index: i64,
    pub base_term: i64,
    pub base_members: Vec<Member>,
    pub listen_port: u16,
    pub state_index: i64,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Eski kümede kolon yoktur; sayaç sıfırdan başlar, karşılaştırma yalnız eşitliğe bakar.
pub async fn ensure_state_column(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('sync_cluster') WHERE name = 'state_index'",
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        sqlx::query("ALTER TABLE sync_cluster ADD COLUMN state_index INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn load_cluster(conn: &mut SqliteConnection) -> Result<Option<ClusterRow>, String> {
    let row = sqlx::query(
        "SELECT tenant_id, cluster_id, current_term, voted_for, commit_index, base_index,
                base_term, base_members, listen_port, state_index
         FROM sync_cluster WHERE slot = 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let base_members: String = row.try_get("base_members").map_err(text_error)?;
    let listen_port: i64 = row.try_get("listen_port").map_err(text_error)?;
    Ok(Some(ClusterRow {
        tenant_id: row.try_get("tenant_id").map_err(text_error)?,
        cluster_id: row.try_get("cluster_id").map_err(text_error)?,
        term: row.try_get("current_term").map_err(text_error)?,
        voted_for: row.try_get("voted_for").map_err(text_error)?,
        commit_index: row.try_get("commit_index").map_err(text_error)?,
        base_index: row.try_get("base_index").map_err(text_error)?,
        base_term: row.try_get("base_term").map_err(text_error)?,
        base_members: serde_json::from_str(&base_members).map_err(|e| e.to_string())?,
        listen_port: u16::try_from(listen_port).map_err(|e| e.to_string())?,
        state_index: row.try_get("state_index").map_err(text_error)?,
    }))
}

pub async fn insert_cluster(conn: &mut SqliteConnection, row: &ClusterRow) -> Result<(), String> {
    let members = serde_json::to_string(&row.base_members).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_cluster (slot, tenant_id, cluster_id, current_term, voted_for,
                                   commit_index, base_index, base_term, base_members, listen_port,
                                   state_index)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&row.tenant_id)
    .bind(&row.cluster_id)
    .bind(row.term)
    .bind(&row.voted_for)
    .bind(row.commit_index)
    .bind(row.base_index)
    .bind(row.base_term)
    .bind(members)
    .bind(i64::from(row.listen_port))
    .bind(row.state_index)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

pub async fn save_vote(
    conn: &mut SqliteConnection,
    term: i64,
    voted_for: Option<&str>,
) -> Result<(), String> {
    sqlx::query("UPDATE sync_cluster SET current_term = ?, voted_for = ? WHERE slot = 1")
        .bind(term)
        .bind(voted_for)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

pub async fn save_commit(conn: &mut SqliteConnection, commit_index: i64) -> Result<(), String> {
    sqlx::query("UPDATE sync_cluster SET commit_index = ? WHERE slot = 1 AND commit_index < ?")
        .bind(commit_index)
        .bind(commit_index)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Günlüğün son konumu; günlük boşsa anlık görüntü sınırıdır.
pub async fn last_position(
    conn: &mut SqliteConnection,
    row: &ClusterRow,
) -> Result<(i64, i64), String> {
    let last = sqlx::query(
        "SELECT log_index, log_term FROM sync_operations
         WHERE tenant_id = ? AND log_index > ? ORDER BY log_index DESC LIMIT 1",
    )
    .bind(&row.tenant_id)
    .bind(row.base_index)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    match last {
        Some(last) => Ok((
            last.try_get("log_index").map_err(text_error)?,
            last.try_get("log_term").map_err(text_error)?,
        )),
        None => Ok((row.base_index, row.base_term)),
    }
}

pub async fn term_at(
    conn: &mut SqliteConnection,
    row: &ClusterRow,
    index: i64,
) -> Result<Option<i64>, String> {
    if index == row.base_index {
        return Ok(Some(row.base_term));
    }
    if index < row.base_index {
        return Ok(None);
    }
    sqlx::query_scalar("SELECT log_term FROM sync_operations WHERE tenant_id = ? AND log_index = ?")
        .bind(&row.tenant_id)
        .bind(index)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)
}

pub async fn entries_from(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from_index: i64,
    limit: i64,
) -> Result<Vec<LogEntry>, String> {
    let rows = sqlx::query(
        "SELECT * FROM sync_operations
         WHERE tenant_id = ? AND log_index >= ? ORDER BY log_index ASC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(from_index)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok(LogEntry {
                index: row.try_get("log_index").map_err(text_error)?,
                term: row.try_get("log_term").map_err(text_error)?,
                operation: op_log::operation_from_row(row)?,
            })
        })
        .collect()
}

/// Çakışan onaysız kuyruğu siler. Uygulanmış kayda dokunmak para defterini
/// geri sarmak olurdu; bu durumda işlem durur ve müdahale istenir.
pub async fn truncate_from(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    index: i64,
) -> Result<(), String> {
    let applied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_operations
         WHERE tenant_id = ? AND log_index >= ? AND status != 'PROPOSED'",
    )
    .bind(tenant_id)
    .bind(index)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    if applied > 0 {
        return Err("INTERVENTION: uygulanmış işlem günlükte çakışıyor".to_string());
    }
    sqlx::query("DELETE FROM sync_operations WHERE tenant_id = ? AND log_index >= ?")
        .bind(tenant_id)
        .bind(index)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Geçerli üyelik günlükteki son üyelik kaydıdır, onaylanmamış olsa da.
///
/// Neden: tek cihazlık üyelik değişiminde eski ve yeni çoğunluğun kesişmesi
/// ancak kayıt eklendiği anda yürürlüğe girerse sağlanır. Kayıt silinince
/// sorgu kendiliğinden önceki üyeliğe döner.
pub async fn current_members(
    conn: &mut SqliteConnection,
    row: &ClusterRow,
) -> Result<Vec<Member>, String> {
    let latest: Option<String> = sqlx::query_scalar(
        "SELECT payload FROM sync_operations
         WHERE tenant_id = ? AND log_index > ? AND kind = 'SET_MEMBERS'
         ORDER BY log_index DESC LIMIT 1",
    )
    .bind(&row.tenant_id)
    .bind(row.base_index)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    match latest {
        Some(payload) => {
            match serde_json::from_str::<LogOp>(&payload).map_err(|e| e.to_string())? {
                LogOp::SetMembers(members) => Ok(members),
                _ => Err("INTERNAL: üyelik kaydı bozuk".to_string()),
            }
        }
        None => Ok(row.base_members.clone()),
    }
}

/// Üyeliğin bir değişikliği henüz onay bekliyor mu?
pub async fn has_pending_membership(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_operations
         WHERE tenant_id = ? AND kind = 'SET_MEMBERS' AND status = 'PROPOSED'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(count > 0)
}

pub async fn proposed_up_to(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    commit_index: i64,
) -> Result<Vec<Operation>, String> {
    let rows = sqlx::query(
        "SELECT * FROM sync_operations
         WHERE tenant_id = ? AND log_index <= ? AND status = 'PROPOSED'
         ORDER BY log_index ASC",
    )
    .bind(tenant_id)
    .bind(commit_index)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter().map(op_log::operation_from_row).collect()
}
