//! Vardiya özeti ve beklenen kasa bakiyesi hesabı.
//!
//! Neden bu modül: kasa mutabakatında açılış avansı, nakit satışlar,
//! kasa giriş/çıkış ve nakit iadelerin tek bir fail-closed fonksiyon
//! üzerinden hesaplanmasını sağlar.

use super::dto::{ShiftCalculation, ShiftSummaryDto};
use crate::db::DbPool;
use sqlx::Row;

/// Vardiya özeti kapısını fail-closed geçirir ve kiracıyı çözer.
pub(crate) fn vardiya_oku_kapisi(
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
) -> Result<String, String> {
    crate::rbac::require_any_present(
        actor_role,
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    )?;
    crate::commands::command_helpers::require_tenant_id(tenant_id)
}

/// Beklenen vardiya kasa nakdini hesaplayan ortak fonksiyon.
/// `opening_balance + cash_sales + total_cash_in - total_cash_out - cash_refunds`
/// `cash_sales` hesabı parçalı ödemelerdeki `cashAmountCents` payını da içerir.
pub async fn calculate_expected_shift_balance(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    shift_id: &str,
    opened_at: &str,
    closed_at: Option<&str>,
    opening_balance: i64,
) -> Result<ShiftCalculation, String> {
    // 1. Satışlar ve ödeme yöntemi kırılımları (audit_ledger payment:settled_fifo)
    let mut sales_query = String::from(
        "SELECT
            COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0) as total_sales,
            COALESCE(SUM(
                CASE 
                    WHEN json_extract(payload, '$.cashAmountCents') IS NOT NULL 
                        THEN CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER)
                    WHEN UPPER(COALESCE(json_extract(payload, '$.method'), '')) IN ('CASH', 'NAKIT') 
                        THEN CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
                    ELSE 0 
                END
            ), 0) as cash_sales,
            COALESCE(SUM(
                CASE 
                    WHEN json_extract(payload, '$.cardAmountCents') IS NOT NULL 
                        THEN CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER)
                    WHEN UPPER(COALESCE(json_extract(payload, '$.method'), '')) IN ('CARD', 'KREDI_KARTI', 'CREDIT_CARD') 
                        THEN CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
                    ELSE 0 
                END
            ), 0) as card_sales,
            COALESCE(SUM(
                CASE 
                    WHEN json_extract(payload, '$.mealCardAmountCents') IS NOT NULL 
                        THEN CAST(json_extract(payload, '$.mealCardAmountCents') AS INTEGER)
                    WHEN UPPER(COALESCE(json_extract(payload, '$.method'), '')) IN ('MEAL_CARD', 'YEMEK_KARTI', 'MULTINET', 'SODEXO', 'TICKET', 'SETCARD') 
                        THEN CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
                    ELSE 0 
                END
            ), 0) as meal_card_sales,
            COALESCE(SUM(
                CASE 
                    WHEN json_extract(payload, '$.veresiyeAmountCents') IS NOT NULL 
                        THEN CAST(json_extract(payload, '$.veresiyeAmountCents') AS INTEGER)
                    WHEN UPPER(COALESCE(json_extract(payload, '$.method'), '')) = 'VERESIYE' 
                        THEN CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
                    ELSE 0 
                END
            ), 0) as veresiye_sales,
            COALESCE(SUM(CAST(json_extract(payload, '$.discountCents') AS INTEGER)), 0) as total_discounts
        FROM audit_ledger
        WHERE tenant_id = ? AND action = 'payment:settled_fifo' AND created_at >= ?",
    );

    let sales_row = if let Some(closed) = closed_at {
        sales_query.push_str(" AND created_at <= ?");
        sqlx::query(&sales_query)
            .bind(tenant_id)
            .bind(opened_at)
            .bind(closed)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
    } else {
        sqlx::query(&sales_query)
            .bind(tenant_id)
            .bind(opened_at)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
    };

    let total_sales: i64 = sales_row
        .try_get("total_sales")
        .map_err(|e| e.to_string())?;
    let cash_sales: i64 = sales_row.try_get("cash_sales").map_err(|e| e.to_string())?;
    let card_sales: i64 = sales_row.try_get("card_sales").map_err(|e| e.to_string())?;
    let meal_card_sales: i64 = sales_row
        .try_get("meal_card_sales")
        .map_err(|e| e.to_string())?;
    let veresiye_sales: i64 = sales_row
        .try_get("veresiye_sales")
        .map_err(|e| e.to_string())?;
    let total_discounts: i64 = sales_row
        .try_get("total_discounts")
        .map_err(|e| e.to_string())?;

    // 2. Kasa giriş ve çıkışları
    let movements_row = sqlx::query(
        "SELECT 
            COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN amount_cents ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN amount_cents ELSE 0 END), 0) as total_out
         FROM cash_movements
         WHERE shift_id = ? AND tenant_id = ?",
    )
    .bind(shift_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let total_cash_in: i64 = movements_row
        .try_get("total_in")
        .map_err(|e| e.to_string())?;
    let total_cash_out: i64 = movements_row
        .try_get("total_out")
        .map_err(|e| e.to_string())?;

    // 3. İadeler (refunds tablosu)
    let mut refunds_query = String::from(
        "SELECT 
            COALESCE(SUM(amount_cents), 0) as total_refunds,
            COALESCE(SUM(CASE WHEN UPPER(method) = 'CASH' THEN amount_cents ELSE 0 END), 0) as cash_refunds
         FROM refunds
         WHERE tenant_id = ? AND created_at >= ?",
    );

    let refunds_row = if let Some(closed) = closed_at {
        refunds_query.push_str(" AND created_at <= ?");
        sqlx::query(&refunds_query)
            .bind(tenant_id)
            .bind(opened_at)
            .bind(closed)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
    } else {
        sqlx::query(&refunds_query)
            .bind(tenant_id)
            .bind(opened_at)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
    };

    let total_refunds: i64 = refunds_row
        .try_get("total_refunds")
        .map_err(|e| e.to_string())?;
    let cash_refunds: i64 = refunds_row
        .try_get("cash_refunds")
        .map_err(|e| e.to_string())?;

    let expected_balance =
        opening_balance + cash_sales + total_cash_in - total_cash_out - cash_refunds;

    Ok(ShiftCalculation {
        total_sales,
        cash_sales,
        card_sales,
        meal_card_sales,
        veresiye_sales,
        total_discounts,
        total_cash_in,
        total_cash_out,
        total_refunds,
        cash_refunds,
        expected_balance,
    })
}

#[tauri::command]
pub async fn get_shift_summary(
    shift_id: String,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<ShiftSummaryDto, String> {
    let tenant_id = vardiya_oku_kapisi(actor_role.as_deref(), tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let shift_row = sqlx::query(
        "SELECT opened_at, expected_amount_cents, actual_amount_cents, closed_at, tenant_id 
         FROM shifts WHERE id = ? AND tenant_id = ?",
    )
    .bind(&shift_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let Some(shift) = shift_row else {
        return Err("NOT_FOUND: Vardiya bulunamadı.".into());
    };

    let opening_balance: i64 = shift
        .try_get("expected_amount_cents")
        .map_err(|e| e.to_string())?;
    let actual_closing_balance: Option<i64> = shift
        .try_get("actual_amount_cents")
        .map_err(|e| e.to_string())?;
    let opened_at: String = shift.try_get("opened_at").map_err(|e| e.to_string())?;
    let closed_at: Option<String> = shift.try_get("closed_at").map_err(|e| e.to_string())?;

    let calc = calculate_expected_shift_balance(
        &mut conn,
        &tenant_id,
        &shift_id,
        &opened_at,
        closed_at.as_deref(),
        opening_balance,
    )
    .await?;

    let discrepancy = match actual_closing_balance {
        Some(actual) => actual - calc.expected_balance,
        None => 0,
    };

    Ok(ShiftSummaryDto {
        shift_id,
        total_sales: calc.total_sales,
        total_cash_in: calc.total_cash_in,
        total_cash_out: calc.total_cash_out,
        expected_balance: calc.expected_balance,
        discrepancy,
        actual_closing_balance,
        cash_sales: calc.cash_sales,
        card_sales: calc.card_sales,
        meal_card_sales: calc.meal_card_sales,
        veresiye_sales: calc.veresiye_sales,
        total_refunds: calc.total_refunds,
        total_discounts: calc.total_discounts,
    })
}
