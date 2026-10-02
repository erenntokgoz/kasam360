//! İzin servisi — talep, listeleme ve onay.

use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::{LeaveInput, LeaveRequest};

use super::is_iso_date;

pub async fn list_leaves(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<Vec<LeaveRequest>, String> {
    let rows = match user_id {
        Some(u) => {
            sqlx::query(
                "SELECT id, user_id, kind, start_date, end_date, reason, status, approver_id, decided_at
                   FROM leave_requests WHERE tenant_id = ?1 AND user_id = ?2
                  ORDER BY start_date DESC",
            )
            .bind(tenant_id)
            .bind(u)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query(
                "SELECT id, user_id, kind, start_date, end_date, reason, status, approver_id, decided_at
                   FROM leave_requests WHERE tenant_id = ?1 ORDER BY start_date DESC",
            )
            .bind(tenant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(LeaveRequest {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            kind: r.try_get("kind").map_err(|e| e.to_string())?,
            start_date: r.try_get("start_date").map_err(|e| e.to_string())?,
            end_date: r.try_get("end_date").map_err(|e| e.to_string())?,
            reason: r.try_get("reason").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            approver_id: r.try_get("approver_id").map_err(|e| e.to_string())?,
            decided_at: r.try_get("decided_at").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// İzin talebi oluşturur. Aynı kullanıcı için çakışan izin reddedilir;
/// müdür izin defterine bakıp onaylarken çakışmayı bilmelidir.
pub async fn request_leave(
    pool: &SqlitePool,
    tenant_id: &str,
    input: &LeaveInput,
) -> Result<String, String> {
    if !is_iso_date(&input.start_date) || !is_iso_date(&input.end_date) {
        return Err("izin tarihleri YYYY-MM-DD biciminde olmali".to_string());
    }
    if input.end_date < input.start_date {
        return Err("izin bitişi baslangictan once olamaz".to_string());
    }
    let cakisma: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM leave_requests
          WHERE tenant_id = ?1 AND user_id = ?2 AND status IN ('Bekliyor','Onaylandi')
            AND start_date <= ?3 AND end_date >= ?4",
    )
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.end_date)
    .bind(&input.start_date)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if cakisma > 0 {
        return Err("bu tarihlerde zaten bir izin talebi var".to_string());
    }

    let id = crate::id_generator::generate_id("lve");
    sqlx::query(
        "INSERT INTO leave_requests
             (id, tenant_id, user_id, kind, start_date, end_date, reason, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'Bekliyor',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.kind)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(input.reason.as_deref())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// İzin kararı. Karar veren kişi talebi oluşturan olamaz (self-approval yasağı).
pub async fn decide_leave(
    pool: &SqlitePool,
    tenant_id: &str,
    approver_id: &str,
    leave_id: &str,
    approve: bool,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT user_id, status FROM leave_requests WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(leave_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Err("izin talebi bulunamadi".to_string());
    };
    let talep_sahibi: String = row.try_get("user_id").map_err(|e| e.to_string())?;
    if talep_sahibi == approver_id {
        return Err("kendi iznini kendin onaylayamazsin".to_string());
    }
    let durum: String = row.try_get("status").map_err(|e| e.to_string())?;
    if durum != "Bekliyor" {
        return Err(format!("izin talebi zaten kararli: {durum}"));
    }

    sqlx::query(
        "UPDATE leave_requests SET status = ?3, approver_id = ?4, decided_at = ?5
          WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(leave_id)
    .bind(if approve { "Onaylandi" } else { "Reddedildi" })
    .bind(approver_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

