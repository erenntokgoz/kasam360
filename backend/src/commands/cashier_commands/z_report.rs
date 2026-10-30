//! Z raporu ve kasa farkı açıklaması.
//!
//! Neden sunucuda: rapor istemcide kurulunca KDV, iptal ve iade sıfır görünüyordu;
//! mali belgede bilinmeyen tutar sıfır yazılamaz. Tek kaynak vardiya hesabı ile
//! adisyon satırlarıdır, kapanmış vardiyanın raporu yeniden üretilebilir.

use super::summary::{calculate_expected_shift_balance, vardiya_oku_kapisi};
use crate::db::DbPool;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use serde::Serialize;
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZReportDto {
    pub report_number: String,
    pub tenant_name: String,
    pub tax_number: Option<String>,
    pub shift_id: String,
    pub cashier_name: Option<String>,
    pub opening_cash_cents: i64,
    pub counted_cash_cents: i64,
    pub expected_cash_cents: i64,
    pub difference_cents: i64,
    pub cash_sales_cents: i64,
    pub card_sales_cents: i64,
    pub meal_card_sales_cents: i64,
    pub veresiye_sales_cents: i64,
    pub total_revenue_cents: i64,
    pub total_vat_cents: i64,
    pub void_total_cents: i64,
    pub refund_total_cents: i64,
    pub discount_total_cents: i64,
    pub order_count: i64,
    pub closed_at: String,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

pub async fn build_z_report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    shift_id: &str,
) -> Result<ZReportDto, String> {
    let shift = sqlx::query(
        "SELECT s.opened_at, s.closed_at, s.expected_amount_cents, s.actual_amount_cents,
                s.difference_cents, u.name AS cashier_name, t.name AS tenant_name, t.tax_id
         FROM shifts s
         JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
         WHERE s.id = ? AND s.tenant_id = ?",
    )
    .bind(shift_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| "NOT_FOUND: Vardiya bulunamadı.".to_string())?;

    let closed_at: Option<String> = shift.try_get("closed_at").map_err(text_error)?;
    let closed_at = closed_at
        .ok_or_else(|| "INVALID_STATE: Z raporu kapanmış vardiya için üretilir.".to_string())?;
    let opened_at: String = shift.try_get("opened_at").map_err(text_error)?;
    let opening: i64 = shift.try_get("expected_amount_cents").map_err(text_error)?;
    let counted: Option<i64> = shift.try_get("actual_amount_cents").map_err(text_error)?;
    let difference: Option<i64> = shift.try_get("difference_cents").map_err(text_error)?;
    // Gün sonu sayımsız kapattıysa fark bilinmez; rapor sıfır fark gösteremez.
    let (Some(counted), Some(difference)) = (counted, difference) else {
        return Err("INVALID_STATE: bu vardiyada kasa sayımı yapılmadı.".to_string());
    };

    let calc = calculate_expected_shift_balance(
        conn,
        tenant_id,
        shift_id,
        &opened_at,
        Some(&closed_at),
        opening,
    )
    .await?;

    let orders = sqlx::query(
        "SELECT COALESCE(SUM(oi.tax_amount_cents), 0) AS vat, COUNT(DISTINCT o.id) AS order_count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
         WHERE o.tenant_id = ? AND o.status = 'PAID' AND oi.status != 'CANCELLED'
           AND datetime(o.updated_at) >= datetime(?) AND datetime(o.updated_at) <= datetime(?)",
    )
    .bind(tenant_id)
    .bind(&opened_at)
    .bind(&closed_at)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;

    let void_total_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(COALESCE(json_extract(payload, '$.amountCents'),
                                           json_extract(payload, '$.orderTotalCents')) AS INTEGER)), 0)
         FROM audit_ledger
         WHERE tenant_id = ? AND action IN ('order_item:voided', 'order:voided')
           AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)",
    )
    .bind(tenant_id)
    .bind(&opened_at)
    .bind(&closed_at)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;

    let suffix: String = shift_id
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    Ok(ZReportDto {
        report_number: format!("Z-{}", suffix.to_uppercase()),
        tenant_name: shift.try_get("tenant_name").map_err(text_error)?,
        tax_number: shift.try_get("tax_id").map_err(text_error)?,
        shift_id: shift_id.to_string(),
        cashier_name: shift.try_get("cashier_name").map_err(text_error)?,
        opening_cash_cents: opening,
        counted_cash_cents: counted,
        expected_cash_cents: calc.expected_balance,
        difference_cents: difference,
        cash_sales_cents: calc.cash_sales,
        card_sales_cents: calc.card_sales,
        meal_card_sales_cents: calc.meal_card_sales,
        veresiye_sales_cents: calc.veresiye_sales,
        total_revenue_cents: calc.total_sales,
        total_vat_cents: orders.try_get("vat").map_err(text_error)?,
        void_total_cents,
        refund_total_cents: calc.total_refunds,
        discount_total_cents: calc.total_discounts,
        order_count: orders.try_get("order_count").map_err(text_error)?,
        closed_at,
    })
}

#[tauri::command]
pub async fn get_z_report(
    shift_id: String,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<ZReportDto, String> {
    let tenant_id = vardiya_oku_kapisi(actor_role.as_deref(), tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    build_z_report(&mut conn, &tenant_id, &shift_id).await
}

/// Kasa farkının açıklamasını deftere yazar; gün sonu açıklanmamış farkla kapanmaz.
///
/// Fark satırı değiştirilmez: açıklama sayımın yerine geçmez, yanına eklenir.
#[tauri::command]
pub async fn explain_shift_difference(
    shift_id: String,
    note: String,
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    state.lan_sync.require_local_write()?;
    let tenant_id = vardiya_oku_kapisi(Some(&actor_role), Some(&tenant_id))?;
    let note = note.trim();
    if note.is_empty() {
        return Err("VALIDATION: fark açıklaması zorunludur.".to_string());
    }
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let difference: Option<Option<i64>> =
        sqlx::query_scalar("SELECT difference_cents FROM shifts WHERE id = ? AND tenant_id = ?")
            .bind(&shift_id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(text_error)?;
    let difference = difference.ok_or_else(|| "NOT_FOUND: Vardiya bulunamadı.".to_string())?;
    let ctx = AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        category::FINANS,
        "shift:difference_explained",
        shift_id,
        serde_json::json!({ "differenceCents": difference, "note": note }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "z_report_tests.rs"]
mod tests;
