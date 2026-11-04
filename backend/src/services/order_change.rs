//! Kapanmış adisyon değişiklik talepleri.
//!
//! Neden ayrı kayıt: kapanmış adisyonun kendisi değişmez. Çalışan gerekçesiyle talep
//! açar, müdür karar verir; önceki kayıt korunur ve parasal düzeltme iade akışından
//! geçer. Müdürün kendi talebi ayrıca onay beklemez, yine de iz bırakır. Onay parayı
//! kendiliğinden oynatmaz: talep, iade yapılana ya da iadesiz kapatılana kadar açık kalır.

use sqlx::{Row, SqliteConnection};

const MAX_REASON_LENGTH: usize = 500;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderChangeRequest {
    pub id: String,
    pub order_id: String,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub requested_by_name: Option<String>,
    pub requested_at: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    pub decision_note: Option<String>,
    pub resolved_at: Option<String>,
}

pub struct NewRequest<'a> {
    pub order_id: &'a str,
    pub reason: &'a str,
    pub actor_id: &'a str,
    pub approved_by_actor: bool,
    pub now: &'a str,
}

fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<OrderChangeRequest, String> {
    let text = |name: &str| row.try_get::<String, _>(name).map_err(|e| e.to_string());
    let optional = |name: &str| {
        row.try_get::<Option<String>, _>(name)
            .map_err(|e| e.to_string())
    };
    Ok(OrderChangeRequest {
        id: text("id")?,
        order_id: text("order_id")?,
        reason: text("reason")?,
        status: text("status")?,
        requested_by: text("requested_by")?,
        requested_by_name: optional("requested_by_name")?,
        requested_at: text("requested_at")?,
        decided_by: optional("decided_by")?,
        decided_at: optional("decided_at")?,
        decision_note: optional("decision_note")?,
        resolved_at: optional("resolved_at")?,
    })
}

/// Yalnız tahsil edilmiş adisyona talep açılır. Aynı adisyonda bekleyen talep varken
/// ikincisi reddedilir: müdür aynı konuya iki kez karar vermesin.
pub async fn create(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    request: &NewRequest<'_>,
) -> Result<String, String> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err("Değişiklik gerekçesi zorunludur.".to_string());
    }
    if reason.chars().count() > MAX_REASON_LENGTH {
        return Err("Gerekçe en fazla 500 karakter olabilir.".to_string());
    }

    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(request.order_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    match status.as_deref() {
        Some("PAID") | Some("COMPENSATED") => {}
        Some(_) => return Err("Yalnız kapanmış adisyon için talep açılır.".to_string()),
        None => return Err("Adisyon bulunamadı.".to_string()),
    }

    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_change_requests
         WHERE tenant_id = ? AND order_id = ?
           AND (status = 'PENDING' OR (status = 'APPROVED' AND resolved_at IS NULL))",
    )
    .bind(tenant_id)
    .bind(request.order_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if open > 0 {
        return Err("Bu adisyon için açık bir talep var.".to_string());
    }

    let id = crate::id_generator::generate_id("ocr");
    let (status, decided_by, decided_at) = if request.approved_by_actor {
        ("APPROVED", Some(request.actor_id), Some(request.now))
    } else {
        ("PENDING", None, None)
    };
    sqlx::query(
        "INSERT INTO order_change_requests
            (id, tenant_id, order_id, reason, status, requested_by, requested_at, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(request.order_id)
    .bind(reason)
    .bind(status)
    .bind(request.actor_id)
    .bind(request.now)
    .bind(decided_by)
    .bind(decided_at)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// En yeni talep üstte gelir. Açık liste karar bekleyenle, onaylanıp henüz düzeltilmemişi taşır.
pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    only_open: bool,
) -> Result<Vec<OrderChangeRequest>, String> {
    let rows = sqlx::query(
        "SELECT r.id, r.order_id, r.reason, r.status, r.requested_by, u.name AS requested_by_name,
                r.requested_at, r.decided_by, r.decided_at, r.decision_note, r.resolved_at
         FROM order_change_requests r
         LEFT JOIN users u ON u.id = r.requested_by AND u.tenant_id = r.tenant_id
         WHERE r.tenant_id = ?
           AND (? = 0 OR r.status = 'PENDING' OR (r.status = 'APPROVED' AND r.resolved_at IS NULL))
         ORDER BY r.requested_at DESC, r.id DESC
         LIMIT 200",
    )
    .bind(tenant_id)
    .bind(i64::from(only_open))
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(from_row).collect()
}

/// Karar yalnız bekleyen talebe verilir ve sonradan değişmez. Talebi açan kendi
/// talebine karar veremez: onayın anlamı ikinci bir kişinin görmesidir.
pub async fn decide(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    approve: bool,
    actor_id: &str,
    note: Option<&str>,
    now: &str,
) -> Result<String, String> {
    let requester: Option<String> = sqlx::query_scalar(
        "SELECT requested_by FROM order_change_requests
         WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some(requester) = requester else {
        return Err("Bekleyen talep bulunamadı.".to_string());
    };
    if requester == actor_id {
        return Err("Kendi talebinize karar veremezsiniz.".to_string());
    }

    let status = if approve { "APPROVED" } else { "REJECTED" };
    sqlx::query(
        "UPDATE order_change_requests
         SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
         WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(status)
    .bind(actor_id)
    .bind(now)
    .bind(note.map(str::trim).filter(|text| !text.is_empty()))
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(status.to_string())
}

/// Onaylı talebi kapatır. İade ayrı kayıttır; bu adım yalnız işin bittiğini işaretler ve
/// aynı talep ikinci kez kapatılamaz.
pub async fn resolve(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    actor_id: &str,
    now: &str,
) -> Result<(), String> {
    let result = sqlx::query(
        "UPDATE order_change_requests
         SET resolved_by = ?, resolved_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'APPROVED' AND resolved_at IS NULL",
    )
    .bind(actor_id)
    .bind(now)
    .bind(id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Kapatılacak onaylı talep bulunamadı.".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "order_change_tests.rs"]
mod tests;
