//! Vardiya planı servisi — planlama tablosu üzerinde.
//!
//! Gerçekleşen vardiya `shifts` tablosunda tutulur (kasa vardiyası). Plan ile
//! gerçekleşen vardiyayı karıştırmamak için ayrı yüzeylerdir.

use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::{ShiftPlan, ShiftPlanInput};

use super::is_iso_date;

pub async fn list_shift_plans(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<ShiftPlan>, String> {
    if from > to {
        return Err(format!("tarih araligi ters: {from} > {to}"));
    }
    let rows = sqlx::query(
        "SELECT sp.id, sp.user_id, sp.full_name, sp.plan_date, sp.start_time, sp.end_time,
                sp.planned_break_minutes, sp.role_required, sp.station, sp.status,
                sp.realized_shift_id
           FROM shift_plans sp
           JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
          WHERE sp.tenant_id = ?1 AND sp.plan_date >= ?2 AND sp.plan_date <= ?3
          ORDER BY sp.plan_date ASC, sp.start_time ASC",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(ShiftPlan {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            user_name: r.try_get("full_name").map_err(|e| e.to_string())?,
            plan_date: r.try_get("plan_date").map_err(|e| e.to_string())?,
            start_time: r.try_get("start_time").map_err(|e| e.to_string())?,
            end_time: r.try_get("end_time").map_err(|e| e.to_string())?,
            planned_break_minutes: r
                .try_get("planned_break_minutes")
                .map_err(|e| e.to_string())?,
            role_required: r.try_get("role_required").map_err(|e| e.to_string())?,
            station: r.try_get("station").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            realized_shift_id: r.try_get("realized_shift_id").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// Vardiya planı ekler. Bitiş, başlangıçtan sonra olmalıdır; aksi halde
/// "gece vardiyası" adı altında negatif saatli plan kaydedilirdi.
pub async fn add_shift_plan(
    pool: &SqlitePool,
    tenant_id: &str,
    actor_id: &str,
    plan: &ShiftPlanInput,
) -> Result<String, String> {
    if !is_iso_date(&plan.plan_date) {
        return Err("plan tarihi YYYY-MM-DD biciminde olmali".to_string());
    }
    if plan.end_time <= plan.start_time {
        return Err("vardiya bitisi baslangictan sonra olmali".to_string());
    }
    if plan.planned_break_minutes < 0 {
        return Err("mola negatif olamaz".to_string());
    }
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1")
            .bind(tenant_id)
            .bind(&plan.user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(format!("kullanici bulunamadi: {}", plan.user_id));
    }

    let id = crate::id_generator::generate_id("spl");
    sqlx::query(
        "INSERT INTO shift_plans
             (id, tenant_id, user_id, plan_date, start_time, end_time,
              planned_break_minutes, role_required, station, status, created_by,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Planned', ?10,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&plan.user_id)
    .bind(&plan.plan_date)
    .bind(&plan.start_time)
    .bind(&plan.end_time)
    .bind(plan.planned_break_minutes)
    .bind(&plan.role_required)
    .bind(plan.station.as_deref())
    .bind(actor_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

