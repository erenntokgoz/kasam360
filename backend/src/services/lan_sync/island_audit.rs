//! Ada döneminin denetim alt zinciri.
//!
//! Ana zincir (`audit_ledger`) her cihazda birebir aynı olmalıdır; ada döneminde iki
//! cihaz aynı sıra numarasını üretir ve satır silinemediği için ana zincir bir daha
//! birleşemezdi. Bu yüzden otoritesiz yazmanın denetim kaydı cihazın kendi alt
//! zincirine, ana zincirle aynı kanonik biçim ve SHA-256 ile mühürlenerek eklenir.
//! Birleşmede satırlar olduğu gibi taşınır; ana zincire uç özetini taşıyan tek kayıt
//! eklenir. `UPDATE`/`DELETE` veritabanı tetikleyicisiyle kilitlidir.

use crate::services::audit_service::{AuditContext, AuditService, GENESIS_HASH, HASH_VERSION};
use sqlx::{Row, SqliteConnection};

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Yazma ada kipinde mi? Kapı yalnız transaction içinde satır taşır.
///
/// Kapı tablosu olmayan veritabanı (eşitleme şeması kurulmamış yardımcı dosya) ada
/// kipine giremez; bu durumda kayıt ana zincire gider.
pub async fn island_gate(conn: &mut SqliteConnection) -> Result<bool, String> {
    let open: Result<Option<i64>, sqlx::Error> =
        sqlx::query_scalar("SELECT 1 FROM sync_write_gate WHERE mode = 'ISLAND' LIMIT 1")
            .fetch_optional(&mut *conn)
            .await;
    match open {
        Ok(found) => Ok(found.is_some()),
        Err(error) if error.to_string().contains("no such table") => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

/// Alt zincire tek kayıt ekler. Cihaz kimliği yoksa yazma reddedilir: kime ait
/// olduğu bilinmeyen alt zincir birleştirilemez.
pub async fn append(conn: &mut SqliteConnection, ctx: &AuditContext) -> Result<String, String> {
    let device_id: String =
        sqlx::query_scalar("SELECT device_id FROM local_device_identity WHERE slot = 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?
            .ok_or_else(|| "UNCONFIGURED: yerel cihaz kimliği tanımlı değil".to_string())?;
    let tip = sqlx::query(
        "SELECT device_sequence, current_hash FROM audit_island_ledger
         WHERE device_id = ? ORDER BY device_sequence DESC LIMIT 1",
    )
    .bind(&device_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let (sequence, previous) = match tip {
        Some(row) => (
            row.try_get::<i64, _>("device_sequence")
                .map_err(text_error)?
                + 1,
            row.try_get::<String, _>("current_hash")
                .map_err(text_error)?,
        ),
        None => (1, GENESIS_HASH.to_string()),
    };
    let payload = serde_json::to_string(&ctx.payload).map_err(|e| e.to_string())?;
    let hash = AuditService::compute_audit_hash(
        sequence,
        &ctx.now_iso,
        &ctx.actor_id,
        &ctx.actor_role,
        &ctx.action,
        &ctx.resource_id,
        &payload,
        &previous,
    );
    let id = crate::id_generator::generate_id("ial");
    sqlx::query(
        "INSERT INTO audit_island_ledger (id, tenant_id, device_id, device_sequence, timestamp,
                                          actor_id, actor_role, category, action, resource_id,
                                          payload, previous_hash, current_hash, hash_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.tenant_id)
    .bind(&device_id)
    .bind(sequence)
    .bind(&ctx.now_iso)
    .bind(&ctx.actor_id)
    .bind(&ctx.actor_role)
    .bind(ctx.category)
    .bind(&ctx.action)
    .bind(&ctx.resource_id)
    .bind(&payload)
    .bind(&previous)
    .bind(&hash)
    .bind(HASH_VERSION)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Cihazın alt zincirini baştan doğrular; bozuk ilk sırayı döndürür.
pub async fn verify(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    device_id: &str,
) -> Result<Option<i64>, String> {
    let rows = sqlx::query(
        "SELECT device_sequence, timestamp, actor_id, actor_role, action, resource_id, payload,
                previous_hash, current_hash
         FROM audit_island_ledger WHERE tenant_id = ? AND device_id = ?
         ORDER BY device_sequence ASC",
    )
    .bind(tenant_id)
    .bind(device_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut previous = GENESIS_HASH.to_string();
    for (position, row) in rows.iter().enumerate() {
        let sequence: i64 = row.try_get("device_sequence").map_err(text_error)?;
        let stored_previous: String = row.try_get("previous_hash").map_err(text_error)?;
        let stored: String = row.try_get("current_hash").map_err(text_error)?;
        let expected = AuditService::compute_audit_hash(
            sequence,
            &row.try_get::<String, _>("timestamp").map_err(text_error)?,
            &row.try_get::<String, _>("actor_id").map_err(text_error)?,
            &row.try_get::<String, _>("actor_role").map_err(text_error)?,
            &row.try_get::<String, _>("action").map_err(text_error)?,
            &row.try_get::<String, _>("resource_id")
                .map_err(text_error)?,
            &row.try_get::<String, _>("payload").map_err(text_error)?,
            &previous,
        );
        let in_order = i64::try_from(position + 1).map_err(|e| e.to_string())? == sequence;
        if !in_order || stored_previous != previous || stored != expected {
            return Ok(Some(sequence));
        }
        previous = stored;
    }
    Ok(None)
}

/// Kümeye gidemeyen işlemin ana zincir satırını alt zincire mühürler. Yük, yazıldığı
/// anda maskelenmiştir; olduğu gibi taşınır, yeniden maskelenmez.
pub async fn append_row(
    conn: &mut SqliteConnection,
    row: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let text = |field: &str| -> Result<String, String> {
        row.get(field)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("INTERNAL: denetim satırında {field} eksik"))
    };
    let category = text("category")?;
    let category = crate::services::audit_service::category::ALL
        .iter()
        .find(|known| **known == category)
        .copied()
        .ok_or_else(|| format!("UNKNOWN_AUDIT_CATEGORY: '{category}'"))?;
    let payload: serde_json::Value =
        serde_json::from_str(&text("payload")?).map_err(|e| e.to_string())?;
    let ctx = AuditContext {
        tenant_id: text("tenant_id")?,
        actor_id: text("actor_id")?,
        actor_role: text("actor_role")?,
        category,
        action: text("action")?,
        resource_id: text("resource_id")?,
        payload,
        now_iso: text("timestamp")?,
    };
    append(conn, &ctx).await
}
