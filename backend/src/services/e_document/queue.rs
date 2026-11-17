//! Kalıcı yerel e-Belge kuyruğu: taslak, gönderilecek, gönderildi, hata.
//!
//! Neden ETTN ve adisyon başına tek satır: aynı adisyondan ikinci belge çıkması çift
//! beyan demektir. `(tenant_id, order_id)` ve `(tenant_id, ettn)` tekil indeksleri bunu
//! veritabanı seviyesinde de dayatır; `create_draft` mevcut satırı döndürerek tekrarlı
//! çağrıyı zararsız yapar. Belge numarası kiracı ve yıl başına müteselsildir.
//!
//! Yazan işlevler çağıranın açtığı yazma işlemi ve denetim kilidi içinde çalışır.

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

use super::settings;
use super::source;
use super::xml;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

pub const DRAFT: &str = "DRAFT";
pub const PENDING: &str = "PENDING";
pub const SENT: &str = "SENT";
pub const FAILED: &str = "FAILED";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub order_id: String,
    pub ettn: String,
    pub document_number: String,
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub total_cents: i64,
    pub provider_ref: Option<String>,
    pub remote_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sent_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueCounts {
    pub draft: i64,
    pub pending: i64,
    pub sent: i64,
    pub failed: i64,
}

const ENTRY_SELECT: &str = "SELECT id, order_id, ettn, document_number, status, attempts, \
        last_error, total_cents, provider_ref, remote_status, created_at, updated_at, sent_at \
     FROM e_document_queue WHERE tenant_id = ?";

fn read_entry(row: &sqlx::sqlite::SqliteRow) -> Result<QueueEntry, String> {
    let text = |name: &str| row.try_get::<String, _>(name).map_err(|e| e.to_string());
    let opt = |name: &str| {
        row.try_get::<Option<String>, _>(name)
            .map_err(|e| e.to_string())
    };
    Ok(QueueEntry {
        id: text("id")?,
        order_id: text("order_id")?,
        ettn: text("ettn")?,
        document_number: text("document_number")?,
        status: text("status")?,
        attempts: row.try_get("attempts").map_err(|e| e.to_string())?,
        last_error: opt("last_error")?,
        total_cents: row.try_get("total_cents").map_err(|e| e.to_string())?,
        provider_ref: opt("provider_ref")?,
        remote_status: opt("remote_status")?,
        created_at: text("created_at")?,
        updated_at: text("updated_at")?,
        sent_at: opt("sent_at")?,
    })
}

pub async fn find(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<Option<QueueEntry>, String> {
    let row = sqlx::query(&format!("{ENTRY_SELECT} AND id = ?"))
        .bind(tenant_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    row.as_ref().map(read_entry).transpose()
}

async fn find_by_order(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Option<QueueEntry>, String> {
    let row = sqlx::query(&format!("{ENTRY_SELECT} AND order_id = ?"))
        .bind(tenant_id)
        .bind(order_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    row.as_ref().map(read_entry).transpose()
}

pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<QueueEntry>, String> {
    if let Some(status) = status {
        if ![DRAFT, PENDING, SENT, FAILED].contains(&status) {
            return Err("VALIDATION: durum filtresi geçersiz".to_string());
        }
    }
    let rows = sqlx::query(&format!(
        "{ENTRY_SELECT} AND (? IS NULL OR status = ?) ORDER BY created_at DESC, id DESC LIMIT ?"
    ))
    .bind(tenant_id)
    .bind(status)
    .bind(status)
    .bind(limit.clamp(1, 500))
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(read_entry).collect()
}

pub async fn counts(conn: &mut SqliteConnection, tenant_id: &str) -> Result<QueueCounts, String> {
    let rows = sqlx::query(
        "SELECT status, COUNT(*) AS cnt FROM e_document_queue WHERE tenant_id = ? GROUP BY status",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut counts = QueueCounts::default();
    for row in &rows {
        let status: String = row.try_get("status").map_err(|e| e.to_string())?;
        let count: i64 = row.try_get("cnt").map_err(|e| e.to_string())?;
        match status.as_str() {
            DRAFT => counts.draft = count,
            PENDING => counts.pending = count,
            SENT => counts.sent = count,
            FAILED => counts.failed = count,
            _ => {}
        }
    }
    Ok(counts)
}

pub async fn get_xml(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<String, String> {
    sqlx::query_scalar("SELECT xml FROM e_document_queue WHERE tenant_id = ? AND id = ?")
        .bind(tenant_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: belge bulunamadı".to_string())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn audit(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::FINANS,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await.map(|_| ())
}

/// Kiracı ve yıl başına müteselsil sıra; yazma işlemi içinde çağrılmalıdır.
async fn next_number(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    year: i32,
    series: &str,
) -> Result<String, String> {
    let sequence: i64 = sqlx::query_scalar(
        "INSERT INTO e_document_sequences (tenant_id, year, last_number) VALUES (?, ?, 1) \
         ON CONFLICT(tenant_id, year) DO UPDATE SET last_number = last_number + 1 \
         RETURNING last_number",
    )
    .bind(tenant_id)
    .bind(year)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if sequence > 999_999_999 {
        return Err("OVERFLOW: yıllık belge numarası sınırı aşıldı".to_string());
    }
    Ok(format!("{series}{year:04}{sequence:09}"))
}

fn digest(xml: &str) -> String {
    hex::encode(Sha256::digest(xml.as_bytes()))
}

fn year_of(order_closed: &str) -> Result<i32, String> {
    use chrono::Datelike;
    let local = chrono::FixedOffset::east_opt(3 * 3600)
        .ok_or_else(|| "saat dilimi oluşturulamadı".to_string())?;
    Ok(source::parse_time(order_closed)?
        .with_timezone(&local)
        .year())
}

/// Kapanmış adisyondan TASLAK belge üretir. Aynı adisyon için ikinci çağrı mevcut
/// satırı döndürür; ikinci ETTN veya numara tüketilmez.
pub async fn create_draft(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    order_id: &str,
) -> Result<QueueEntry, String> {
    let config = settings::get(conn, tenant_id).await?;
    let supplier = settings::supplier_of(&config)?;
    if let Some(existing) = find_by_order(conn, tenant_id, order_id).await? {
        return Ok(existing);
    }
    let ettn = uuid::Uuid::new_v4().to_string();
    let session_ettn = uuid::Uuid::new_v4().to_string();
    // Numara yılı belgenin düzenlenme (kapanış) yılıdır; önce geçici numarayla yıl okunur.
    let probe = source::load_document(
        conn,
        tenant_id,
        order_id,
        supplier.clone(),
        (&ettn, &session_ettn, "ADS0000000000000"),
    )
    .await?;
    let year = year_of(&probe.closed_at.to_rfc3339())?;
    let number = next_number(conn, tenant_id, year, &config.series_code).await?;
    let mut doc = probe;
    doc.document_number = number.clone();
    let body = xml::build_xml(&doc)?;
    let total: i64 = doc.lines.iter().map(|l| l.gross_cents).sum();
    let id = crate::id_generator::generate_id("edq");
    sqlx::query(
        "INSERT INTO e_document_queue \
            (id, tenant_id, order_id, ettn, session_ettn, document_number, status, xml, xml_sha256, total_cents) \
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(order_id)
    .bind(&ettn)
    .bind(&session_ettn)
    .bind(&number)
    .bind(&body)
    .bind(digest(&body))
    .bind(total)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "e_document:draft_created",
        &id,
        serde_json::json!({ "orderId": order_id, "ettn": ettn, "documentNumber": number }),
    )
    .await?;
    find(conn, tenant_id, &id)
        .await?
        .ok_or_else(|| "belge yazıldıktan sonra okunamadı".to_string())
}

/// TASLAK belgenin XML'ini güncel ayar ve adisyon verisiyle yeniden kurar; ETTN ve numara korunur.
pub async fn rebuild_draft(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    id: &str,
) -> Result<QueueEntry, String> {
    let entry = find(conn, tenant_id, id)
        .await?
        .ok_or_else(|| "NOT_FOUND: belge bulunamadı".to_string())?;
    if entry.status != DRAFT {
        return Err("CONFLICT: yalnız taslak belge yeniden kurulabilir".to_string());
    }
    let supplier = settings::supplier_of(&settings::get(conn, tenant_id).await?)?;
    let session_ettn: String = sqlx::query_scalar(
        "SELECT session_ettn FROM e_document_queue WHERE tenant_id = ? AND id = ?",
    )
    .bind(tenant_id)
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let doc = source::load_document(
        conn,
        tenant_id,
        &entry.order_id,
        supplier,
        (&entry.ettn, &session_ettn, &entry.document_number),
    )
    .await?;
    let body = xml::build_xml(&doc)?;
    let total: i64 = doc.lines.iter().map(|l| l.gross_cents).sum();
    sqlx::query(
        "UPDATE e_document_queue SET xml = ?, xml_sha256 = ?, total_cents = ?, \
            updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ? AND status = 'DRAFT'",
    )
    .bind(&body)
    .bind(digest(&body))
    .bind(total)
    .bind(tenant_id)
    .bind(id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "e_document:draft_rebuilt",
        id,
        serde_json::json!({ "orderId": entry.order_id }),
    )
    .await?;
    find(conn, tenant_id, id)
        .await?
        .ok_or_else(|| "belge güncellendikten sonra okunamadı".to_string())
}

async fn transition(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    who: (&str, &str, &str),
    id: &str,
    from: &str,
    action: &str,
) -> Result<QueueEntry, String> {
    let (tenant_id, actor_id, actor_role) = who;
    let result = sqlx::query(
        "UPDATE e_document_queue SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP \
         WHERE tenant_id = ? AND id = ? AND status = ?",
    )
    .bind(tenant_id)
    .bind(id)
    .bind(from)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!(
            "CONFLICT: belge {from} durumunda değil veya bulunamadı"
        ));
    }
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        action,
        id,
        serde_json::json!({ "from": from }),
    )
    .await?;
    find(conn, tenant_id, id)
        .await?
        .ok_or_else(|| "belge güncellendikten sonra okunamadı".to_string())
}

/// TASLAK → GÖNDERİLECEK. Gönderimi bu işlem başlatmaz; kuyruk işleyicisi gönderir.
pub async fn submit(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    id: &str,
) -> Result<QueueEntry, String> {
    let config = settings::get(conn, tenant_id).await?;
    settings::supplier_of(&config)?;
    transition(
        conn,
        lock,
        (tenant_id, actor_id, actor_role),
        id,
        DRAFT,
        "e_document:submitted",
    )
    .await
}

/// HATA → GÖNDERİLECEK. Deneme sayacı korunur; geçmiş gizlenmez.
pub async fn retry(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    id: &str,
) -> Result<QueueEntry, String> {
    transition(
        conn,
        lock,
        (tenant_id, actor_id, actor_role),
        id,
        FAILED,
        "e_document:retried",
    )
    .await
}

/// Belge bekleyen kapanmış adisyon: ödenmiş ve henüz kuyrukta satırı olmayan.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub order_id: String,
    pub table_name: String,
    pub total_cents: i64,
    pub closed_at: String,
}

pub async fn candidates(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    limit: i64,
) -> Result<Vec<Candidate>, String> {
    let rows = sqlx::query(
        "SELECT o.id, COALESCE(t.name, o.table_id) AS table_name, o.total_cents, o.updated_at \
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id \
         WHERE o.tenant_id = ? AND o.status = 'PAID' AND NOT EXISTS ( \
             SELECT 1 FROM e_document_queue q WHERE q.tenant_id = o.tenant_id AND q.order_id = o.id) \
         ORDER BY o.updated_at DESC, o.id DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            Ok(Candidate {
                order_id: row.try_get("id").map_err(|e| e.to_string())?,
                table_name: row.try_get("table_name").map_err(|e| e.to_string())?,
                total_cents: row.try_get("total_cents").map_err(|e| e.to_string())?,
                closed_at: row.try_get("updated_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}
