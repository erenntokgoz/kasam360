//! Zimmet servisi — demirbaş teslim ve iade.

use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::CustodyRecord;

pub async fn list_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    only_open: bool,
) -> Result<Vec<CustodyRecord>, String> {
    let sql = if only_open {
        "SELECT id, user_id, item_name, quantity, status, delivered_at, returned_at, notes
           FROM custody_records WHERE tenant_id = ?1 AND status = 'Teslim'
          ORDER BY delivered_at DESC"
    } else {
        "SELECT id, user_id, item_name, quantity, status, delivered_at, returned_at, notes
           FROM custody_records WHERE tenant_id = ?1 ORDER BY delivered_at DESC"
    };
    let rows = sqlx::query(sql)
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(CustodyRecord {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            item_name: r.try_get("item_name").map_err(|e| e.to_string())?,
            quantity: r.try_get("quantity").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            delivered_at: r.try_get("delivered_at").map_err(|e| e.to_string())?,
            returned_at: r.try_get("returned_at").map_err(|e| e.to_string())?,
            notes: r.try_get("notes").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub async fn add_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    item_name: &str,
    quantity: i64,
    notes: Option<&str>,
) -> Result<String, String> {
    let name = item_name.trim();
    if name.is_empty() {
        return Err("zimmet kalemi bos olamaz".to_string());
    }
    if quantity <= 0 {
        return Err("adet sifirdan buyuk olmali".to_string());
    }
    let id = crate::id_generator::generate_id("cst");
    sqlx::query(
        "INSERT INTO custody_records
             (id, tenant_id, user_id, item_name, quantity, status, delivered_at, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, 'Teslim',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?6)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(name)
    .bind(quantity)
    .bind(notes)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn return_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    custody_id: &str,
    damaged: bool,
) -> Result<(), String> {
    let row = sqlx::query("SELECT status FROM custody_records WHERE tenant_id = ?1 AND id = ?2")
        .bind(tenant_id)
        .bind(custody_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Err("zimmet kaydi bulunamadi".to_string());
    };
    let durum: String = row.try_get("status").map_err(|e| e.to_string())?;
    if durum != "Teslim" {
        return Err(format!("zimmet zaten kapali: {durum}"));
    }
    sqlx::query(
        "UPDATE custody_records SET status = ?3, returned_at = ?4 WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(custody_id)
    .bind(if damaged { "Hasarli" } else { "Iade" })
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

