//! Tek cihaz yazmasının günlük kaydı.
//!
//! Tek cihazda transaction yerelde onaylanır; yakalanan satır değişiklikleri aynı
//! transaction'da `APPLIED` kayıt olarak günlüğe eklenir. Böylece buluta gönderim
//! (`sync_cloud_cursor`) ve sonradan katılan cihaz aynı akışı görür; iş kaydı ile
//! günlük kaydı birbirinden ayrı onaylanamaz.
//!
//! Tek üyeli kümede kayıt otoritenin günlük sırasına eklenir ve onay konumu da
//! ilerletilir: yeni cihazın anlık görüntüsü bu kaydı kapsar, günlükten ikinci kez
//! uygulanmaz.

use super::capture::{self, RowChange};
use super::op_log::{intent_hash, LogOp, Operation};
use super::store;
use crate::services::device_identity::ensure_local_device;
use sqlx::SqliteConnection;

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Kaydın kiracısı. Kurulum sihirbazı ilk yazmada kimliği henüz bağlamamış olabilir;
/// bu durumda yazılan satırın kendi kiracısı kullanılır.
async fn resolve_tenant(
    conn: &mut SqliteConnection,
    changes: &[RowChange],
) -> Result<Option<String>, String> {
    let bound: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM local_device_identity WHERE slot = 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    if bound.is_some() {
        return Ok(bound);
    }
    let setup: Option<Option<String>> =
        sqlx::query_scalar("SELECT tenant_id FROM app_setup WHERE slot = 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    if let Some(Some(tenant)) = setup {
        return Ok(Some(tenant));
    }
    let from_rows = changes.iter().find_map(|change| {
        let row = change.row.as_ref().or(change.old.as_ref())?;
        let field = if change.table == "tenants" {
            "id"
        } else {
            "tenant_id"
        };
        row.get(field)?.as_str().map(str::to_string)
    });
    Ok(from_rows)
}

/// Bekleyen yakalamayı günlüğe yazar ve boşaltır; değişiklik yoksa hiçbir şey yazmaz.
///
/// Kiracı belirlenemezse yakalama silinmez: satırlar bir sonraki yazmayla, kimlik
/// bağlandıktan sonra günlüğe girer. Yazma bu yüzden reddedilmez.
pub async fn flush(conn: &mut SqliteConnection) -> Result<Option<String>, String> {
    let preview = capture::read_capture(conn).await?;
    if preview.is_empty() {
        return Ok(None);
    }
    let Some(tenant_id) = resolve_tenant(conn, &preview).await? else {
        return Ok(None);
    };
    // Cihaz kaydı ilk yazmada açılabilir; o satır da aynı kayda girsin diye yakalama
    // kimlikten sonra yeniden okunur.
    let device_id = ensure_local_device(conn, &tenant_id).await?;
    let changes = capture::read_capture(conn).await?;
    let cluster = store::load_cluster(conn).await?;
    let (log_index, log_term, base_state) = match &cluster {
        Some(row) => {
            let (last, _) = store::last_position(conn, row).await?;
            (last + 1, row.term, row.state_index)
        }
        None => {
            let last: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(log_index), 0) FROM sync_operations WHERE tenant_id = ?",
            )
            .bind(&tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
            (last + 1, 0, 0)
        }
    };
    let intent = serde_json::to_value(&changes).map_err(|e| e.to_string())?;
    let operation = Operation {
        operation_id: crate::id_generator::generate_id("op"),
        tenant_id,
        device_id,
        actor_id: "SYSTEM".to_string(),
        actor_role: "System".to_string(),
        intent_sha256: intent_hash("CHANGES", &intent),
        op: LogOp::Changes {
            base_state,
            changes,
        },
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    append_applied(conn, &operation, log_index, log_term).await?;
    if cluster.is_some() {
        store::save_commit(conn, log_index).await?;
        sqlx::query("UPDATE sync_cluster SET state_index = state_index + 1 WHERE slot = 1")
            .execute(&mut *conn)
            .await
            .map_err(text_error)?;
    }
    capture::clear_capture(conn).await?;
    Ok(Some(operation.operation_id))
}

/// Yerelde uygulanmış işlemi kalıcı sonucuyla ekler.
async fn append_applied(
    conn: &mut SqliteConnection,
    operation: &Operation,
    log_index: i64,
    log_term: i64,
) -> Result<(), String> {
    let payload = serde_json::to_string(&operation.op).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_operations (operation_id, tenant_id, device_id, actor_id, actor_role,
                                      target_id, kind, intent_sha256, payload, log_index,
                                      log_term, status, result, created_at, applied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', 'null', ?, datetime('now'))",
    )
    .bind(&operation.operation_id)
    .bind(&operation.tenant_id)
    .bind(&operation.device_id)
    .bind(&operation.actor_id)
    .bind(&operation.actor_role)
    .bind(operation.op.target_id())
    .bind(operation.op.kind())
    .bind(&operation.intent_sha256)
    .bind(payload)
    .bind(log_index)
    .bind(log_term)
    .bind(&operation.created_at)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("İşlem günlüğe yazılamadı: {e}"))?;
    Ok(())
}
