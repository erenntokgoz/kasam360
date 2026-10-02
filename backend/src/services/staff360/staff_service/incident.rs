//! Tutanak servisi — personel olay kaydı ve listeleme.

use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::{Incident, IncidentInput};

pub async fn list_incidents(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<Vec<Incident>, String> {
    let rows = match user_id {
        Some(u) => {
            sqlx::query(
                "SELECT id, user_id, kind, severity, occurred_at, summary, details, resolution, status, recorded_by
                   FROM staff_incidents WHERE tenant_id = ?1 AND user_id = ?2
                  ORDER BY occurred_at DESC",
            )
            .bind(tenant_id)
            .bind(u)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query(
                "SELECT id, user_id, kind, severity, occurred_at, summary, details, resolution, status, recorded_by
                   FROM staff_incidents WHERE tenant_id = ?1 ORDER BY occurred_at DESC",
            )
            .bind(tenant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(Incident {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            kind: r.try_get("kind").map_err(|e| e.to_string())?,
            severity: r.try_get("severity").map_err(|e| e.to_string())?,
            occurred_at: r.try_get("occurred_at").map_err(|e| e.to_string())?,
            summary: r.try_get("summary").map_err(|e| e.to_string())?,
            details: r.try_get("details").map_err(|e| e.to_string())?,
            resolution: r.try_get("resolution").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            recorded_by: r.try_get("recorded_by").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub async fn record_incident(
    pool: &SqlitePool,
    tenant_id: &str,
    recorder_id: &str,
    input: &IncidentInput,
) -> Result<String, String> {
    let ozet = input.summary.trim();
    if ozet.is_empty() {
        return Err("tutanak ozeti bos olamaz".to_string());
    }
    let id = crate::id_generator::generate_id("inc");
    sqlx::query(
        "INSERT INTO staff_incidents
             (id, tenant_id, user_id, kind, severity, occurred_at, summary, details, status, recorded_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ACIK', ?9,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.kind)
    .bind(&input.severity)
    .bind(&input.occurred_at)
    .bind(ozet)
    .bind(input.details.as_deref())
    .bind(recorder_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}
