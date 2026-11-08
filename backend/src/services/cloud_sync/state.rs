//! Bulut eşitlemesinin cihazdaki kalıcı durumu: kimlik, imleçler, son hata.
//!
//! Durum diske yazılır: uygulama kapanıp açılınca gönderim kaldığı yerden sürer,
//! hesaptan çıkışın bekleyen silmesi unutulmaz.

use super::api::Credentials;
use sqlx::{Row, SqliteConnection};

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Gönderimin kimliği: işletme ve bu kasanın yerel ağdaki kimliği.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub tenant_id: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StoredState {
    pub pull_after: i64,
    pub baseline_done: bool,
    pub wipe_pending: bool,
    pub last_push_at: Option<String>,
    pub last_pull_at: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudReview {
    pub operation_id: String,
    pub decision: String,
    pub reason: String,
    pub device_id: String,
    pub kind: String,
    pub target_id: String,
    pub created_at: String,
}

pub async fn record_review(
    conn: &mut SqliteConnection,
    identity: &Identity,
    operation_id: &str,
    decision: &str,
    reason: &str,
) -> Result<(), String> {
    if !matches!(decision, "PENDING" | "ACCEPTED" | "REJECTED") {
        return Err("Bulut inceleme kararı geçersiz.".to_string());
    }
    sqlx::query(
        "INSERT INTO sync_cloud_review (tenant_id, operation_id, decision, reason, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(tenant_id, operation_id) DO UPDATE SET
             decision = CASE WHEN sync_cloud_review.decision = 'REJECTED' THEN 'REJECTED' ELSE excluded.decision END,
             reason = CASE WHEN sync_cloud_review.decision = 'REJECTED' THEN sync_cloud_review.reason ELSE excluded.reason END,
             updated_at = datetime('now')",
    )
    .bind(&identity.tenant_id).bind(operation_id).bind(decision).bind(reason)
    .execute(&mut *conn).await.map_err(text_error)?;
    Ok(())
}

pub async fn accept_review(
    conn: &mut SqliteConnection,
    identity: &Identity,
    operation_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE sync_cloud_review SET decision = 'ACCEPTED', reason = 'Bulut işlemi kabul etti.', updated_at = datetime('now')
         WHERE tenant_id = ? AND operation_id = ? AND decision = 'PENDING'",
    ).bind(&identity.tenant_id).bind(operation_id).execute(&mut *conn).await.map_err(text_error)?;
    Ok(())
}

pub async fn reviews(
    conn: &mut SqliteConnection,
    identity: &Identity,
) -> Result<Vec<CloudReview>, String> {
    let found = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
        "SELECT review.operation_id, review.decision, review.reason, review.device_id, review.kind, review.target_id, review.created_at
         FROM (
           SELECT r.operation_id, r.decision, r.reason, o.device_id, o.kind, o.target_id, o.created_at, r.updated_at
           FROM sync_cloud_review r JOIN sync_operations o ON o.tenant_id = r.tenant_id AND o.operation_id = r.operation_id
           WHERE r.tenant_id = ? AND r.decision IN ('PENDING', 'REJECTED')
           UNION ALL
           SELECT r.operation_id, r.decision, r.reason, json_extract(b.operation, '$.deviceId'),
                  json_extract(b.operation, '$.op.domain'), r.operation_id, json_extract(b.operation, '$.createdAt'), r.updated_at
           FROM sync_cloud_review r JOIN sync_cloud_baseline b ON b.tenant_id = r.tenant_id AND b.operation_id = r.operation_id
           WHERE r.tenant_id = ? AND r.decision IN ('PENDING', 'REJECTED')
         ) review
         ORDER BY review.updated_at DESC, review.operation_id DESC LIMIT 100",
    ).bind(&identity.tenant_id).bind(&identity.tenant_id).fetch_all(&mut *conn).await.map_err(text_error)?;
    Ok(found
        .into_iter()
        .map(
            |(operation_id, decision, reason, device_id, kind, target_id, created_at)| {
                CloudReview {
                    operation_id,
                    decision,
                    reason,
                    device_id,
                    kind,
                    target_id,
                    created_at,
                }
            },
        )
        .collect())
}

/// Kurulumu bağlanmış kasanın kimliği; kurulmamış cihazda gönderilecek bir şey yoktur.
pub async fn identity(conn: &mut SqliteConnection) -> Result<Option<Identity>, String> {
    let row = sqlx::query("SELECT tenant_id, device_id FROM local_device_identity WHERE slot = 1")
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(Identity {
        tenant_id: row.try_get("tenant_id").map_err(text_error)?,
        device_id: row.try_get("device_id").map_err(text_error)?,
    }))
}

/// Kurulumun kiracısı; yerel cihaz kimliği henüz açılmamış olabilir.
pub async fn setup_tenant(conn: &mut SqliteConnection) -> Result<Option<String>, String> {
    let tenant: Option<Option<String>> = sqlx::query_scalar(
        "SELECT tenant_id FROM app_setup WHERE slot = 1 AND status = 'COMPLETE'",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(tenant.flatten())
}

/// Lisans anahtarı yoksa bulut kapalıdır; anahtar düz metin olarak hiçbir yere yazılmaz.
pub async fn credentials(conn: &mut SqliteConnection) -> Result<Option<Credentials>, String> {
    let stored = crate::services::license::load(conn).await?;
    let Some(license_key) = stored.license_key else {
        return Ok(None);
    };
    // Sync kapsamı kurulum kaydından gelir; eksik kimlikte yetki sessizce genişletilmez.
    let tenant_id: Option<Option<String>> = sqlx::query_scalar(
        "SELECT tenant_id FROM app_setup WHERE slot = 1 AND status = 'COMPLETE'",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some(tenant_id) = tenant_id.flatten() else {
        return Ok(None);
    };
    Ok(Some(Credentials {
        tenant_id,
        license_key,
        license_device_id: stored.device_id,
    }))
}

pub async fn load(conn: &mut SqliteConnection) -> Result<StoredState, String> {
    sqlx::query("INSERT INTO sync_cloud_state (slot) VALUES (1) ON CONFLICT(slot) DO NOTHING")
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    let row = sqlx::query(
        "SELECT pull_after, baseline_done, wipe_pending, last_push_at, last_pull_at,
                last_error_code, last_error
         FROM sync_cloud_state WHERE slot = 1",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(StoredState {
        pull_after: row.try_get("pull_after").map_err(text_error)?,
        baseline_done: row.try_get::<i64, _>("baseline_done").map_err(text_error)? == 1,
        wipe_pending: row.try_get::<i64, _>("wipe_pending").map_err(text_error)? == 1,
        last_push_at: row.try_get("last_push_at").map_err(text_error)?,
        last_pull_at: row.try_get("last_pull_at").map_err(text_error)?,
        last_error_code: row.try_get("last_error_code").map_err(text_error)?,
        last_error: row.try_get("last_error").map_err(text_error)?,
    })
}

async fn exec(conn: &mut SqliteConnection, statement: &str) -> Result<(), String> {
    load(conn).await?;
    sqlx::query(statement)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

pub async fn mark_pushed(conn: &mut SqliteConnection) -> Result<(), String> {
    exec(
        conn,
        "UPDATE sync_cloud_state SET last_push_at = datetime('now'), last_error_code = NULL,
                last_error = NULL WHERE slot = 1",
    )
    .await
}

pub async fn save_pull_after(conn: &mut SqliteConnection, after: i64) -> Result<(), String> {
    load(conn).await?;
    sqlx::query(
        "UPDATE sync_cloud_state SET pull_after = ?, last_pull_at = datetime('now') WHERE slot = 1",
    )
    .bind(after)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

pub async fn set_baseline_done(conn: &mut SqliteConnection) -> Result<(), String> {
    exec(
        conn,
        "UPDATE sync_cloud_state SET baseline_done = 1 WHERE slot = 1",
    )
    .await
}

pub async fn set_wipe_pending(conn: &mut SqliteConnection, pending: bool) -> Result<(), String> {
    load(conn).await?;
    sqlx::query("UPDATE sync_cloud_state SET wipe_pending = ? WHERE slot = 1")
        .bind(i64::from(pending))
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Son hata kalıcıdır: uygulama yeniden açılınca da ekranda görünür.
pub async fn record_error(
    conn: &mut SqliteConnection,
    code: Option<&str>,
    message: Option<&str>,
) -> Result<(), String> {
    load(conn).await?;
    sqlx::query("UPDATE sync_cloud_state SET last_error_code = ?, last_error = ? WHERE slot = 1")
        .bind(code)
        .bind(message)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Günlükte gönderilen son konum.
pub async fn log_cursor(conn: &mut SqliteConnection, identity: &Identity) -> Result<i64, String> {
    let position: Option<i64> = sqlx::query_scalar(
        "SELECT last_position FROM sync_cloud_cursor
         WHERE tenant_id = ? AND device_id = ? AND stream = 'LOG'",
    )
    .bind(&identity.tenant_id)
    .bind(&identity.device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(position.unwrap_or(0))
}

pub async fn save_log_cursor(
    conn: &mut SqliteConnection,
    identity: &Identity,
    position: i64,
    operation_id: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO sync_cloud_cursor (tenant_id, device_id, stream, last_position,
                                        last_operation_id, updated_at)
         VALUES (?1, ?2, 'LOG', ?3, ?4, datetime('now'))
         ON CONFLICT(tenant_id, device_id, stream) DO UPDATE SET
             last_position = ?3,
             last_operation_id = COALESCE(?4, sync_cloud_cursor.last_operation_id),
             updated_at = datetime('now')",
    )
    .bind(&identity.tenant_id)
    .bind(&identity.device_id)
    .bind(position)
    .bind(operation_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Buluta henüz varmamış işlem sayısı: ilk yükleme ve imleçten sonraki onaylı kayıtlar.
pub async fn pending_count(
    conn: &mut SqliteConnection,
    identity: &Identity,
) -> Result<i64, String> {
    let cursor = log_cursor(conn, identity).await?;
    let baseline: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_cloud_baseline WHERE tenant_id = ? AND pushed = 0",
    )
    .bind(&identity.tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let log: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_operations
         WHERE tenant_id = ? AND log_index > ? AND status IN ('APPLIED', 'PROPOSED')",
    )
    .bind(&identity.tenant_id)
    .bind(cursor)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(baseline + log)
}

/// Çıkışta sunucuya bildirilen sayım: bu kasanın ürettiği ve gönderilmesi gereken işlemler.
pub async fn own_operations(
    conn: &mut SqliteConnection,
    identity: &Identity,
) -> Result<(i64, Option<String>), String> {
    let baseline: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_cloud_baseline WHERE tenant_id = ?")
            .bind(&identity.tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
    let log: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_operations
         WHERE tenant_id = ? AND device_id = ? AND status = 'APPLIED' AND kind != 'ISLAND_MERGE'",
    )
    .bind(&identity.tenant_id)
    .bind(&identity.device_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let merges =
        super::merge_wire::own_merge_operations(conn, &identity.tenant_id, &identity.device_id)
            .await?;
    // Gönderim sırası ilk yükleme, sonra günlüktür; son işlem bu sıranın sonudur. Birleşme
    // kaydının son işlemi bu kasanın yerleşimidir.
    let last_row = sqlx::query(
        "SELECT operation_id, kind FROM sync_operations
         WHERE tenant_id = ? AND status = 'APPLIED' AND (device_id = ? OR kind = 'ISLAND_MERGE')
         ORDER BY log_index DESC LIMIT 1",
    )
    .bind(&identity.tenant_id)
    .bind(&identity.device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let last_log = match last_row {
        Some(row) => {
            let id: String = row.try_get("operation_id").map_err(text_error)?;
            let kind: String = row.try_get("kind").map_err(text_error)?;
            Some(if kind == "ISLAND_MERGE" {
                super::merge_wire::settle_id(&id, &identity.device_id)
            } else {
                id
            })
        }
        None => None,
    };
    let last = match last_log {
        Some(id) => Some(id),
        None => sqlx::query_scalar(
            "SELECT operation_id FROM sync_cloud_baseline WHERE tenant_id = ?
             ORDER BY position DESC LIMIT 1",
        )
        .bind(&identity.tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?,
    };
    Ok((baseline + log + merges, last))
}
