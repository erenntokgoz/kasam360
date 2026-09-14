use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CashMovementDto {
    pub id: String,
    #[serde(rename = "shiftId")]
    pub shift_id: String,
    #[serde(rename = "movementType")]
    pub movement_type: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ShiftSummaryDto {
    #[serde(rename = "shiftId")]
    pub shift_id: String,
    #[serde(rename = "totalSales")]
    pub total_sales: i64,
    #[serde(rename = "totalCashIn")]
    pub total_cash_in: i64,
    #[serde(rename = "totalCashOut")]
    pub total_cash_out: i64,
    #[serde(rename = "expectedBalance")]
    pub expected_balance: i64,
    pub discrepancy: i64,
    #[serde(rename = "actualClosingBalance")]
    pub actual_closing_balance: Option<i64>,
}

#[tauri::command]
pub async fn cash_in(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<CashMovementDto, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    let id = format!("cmin_{}", Uuid::new_v4());
    
    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, 'DEFAULT_TENANT', ?, 'IN', ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "IN".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn cash_out(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<CashMovementDto, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    let id = format!("cmout_{}", Uuid::new_v4());
    
    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, 'DEFAULT_TENANT', ?, 'OUT', ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "OUT".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn get_shift_summary(
    shift_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<ShiftSummaryDto, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    // Get shift details (opening balance, actual closing if any)
    let shift_row = sqlx::query("SELECT opened_at, expected_amount_cents, actual_amount_cents, closed_at FROM shifts WHERE id = ?")
        .bind(&shift_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    if shift_row.is_none() {
        return Err("Shift not found".into());
    }
    
    let shift = shift_row.unwrap();
    let opening_balance: i32 = shift.try_get("expected_amount_cents").unwrap_or(0);
    let opening_balance = opening_balance as i64;
    let actual_closing_balance: Option<i32> = shift.try_get("actual_amount_cents").ok();
    let actual_closing_balance = actual_closing_balance.map(|v| v as i64);
    
    let opened_at: String = shift.try_get("opened_at").unwrap_or_default();
    let closed_at: Option<String> = shift.try_get("closed_at").ok();

    // Get total sales for the shift
    let mut sales_query = String::from(
        "SELECT COALESCE(sum(json_extract(payload, '$.totalAmount')), 0) as total
         FROM audit_ledger 
         WHERE action='payment:settled_fifo' AND created_at >= ?"
    );
    
    let mut query = sqlx::query(&sales_query).bind(&opened_at);
    
    if let Some(ref closed) = closed_at {
        sales_query.push_str(" AND created_at <= ?");
        query = sqlx::query(&sales_query).bind(&opened_at).bind(closed);
    }
    
    let sales_row = query.fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
    let total_sales: i64 = sales_row.try_get("total").unwrap_or(0);
    
    // Get total cash in/out
    let cash_in_row = sqlx::query("SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_movements WHERE shift_id = ? AND movement_type = 'IN'")
        .bind(&shift_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let total_cash_in: i64 = cash_in_row.try_get("total").unwrap_or(0);
    
    let cash_out_row = sqlx::query("SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_movements WHERE shift_id = ? AND movement_type = 'OUT'")
        .bind(&shift_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let total_cash_out: i64 = cash_out_row.try_get("total").unwrap_or(0);
    
    let expected_balance = opening_balance + total_sales + total_cash_in - total_cash_out;
    let discrepancy = if let Some(actual) = actual_closing_balance {
        actual - expected_balance
    } else {
        0
    };
    
    Ok(ShiftSummaryDto {
        shift_id,
        total_sales,
        total_cash_in,
        total_cash_out,
        expected_balance,
        discrepancy,
        actual_closing_balance,
    })
}
