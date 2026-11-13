//! Tezgâh (masasız hızlı satış) özeti: raporlarda masa satışından ayrı görünür.
//!
//! Neden denetim defterinden: ciro tahsilat anında oluşur (`sales_report` ile aynı kaynak ve
//! `[başlangıç, bitiş)` sınırı). Tezgâh siparişleri kiracıya ait görünmez satış noktasına bağlıdır;
//! ayrım o noktanın kimliğiyle yapılır, ciro hesabı iki raporda tutarlı kalır.

use crate::commands::pos_commands::COUNTER_ID_PREFIX;
use crate::services::report_service::ReportRange;
use serde::Serialize;
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CounterPaymentShareDto {
    pub method: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CounterSalesDto {
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub average_order_value_cents: i64,
    pub payment_methods: Vec<CounterPaymentShareDto>,
}

/// Tezgâh satış özeti; her sorgu `tenant_id` ile daralır, hata sıfıra dönüşmez.
pub async fn counter_sales_summary(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    range: &ReportRange,
) -> Result<CounterSalesDto, String> {
    let counter_point = format!("{COUNTER_ID_PREFIX}{tenant_id}");
    let row = sqlx::query(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0) AS revenue,
                COALESCE(SUM(json_extract(payload, '$.orderClosed') = 1), 0) AS order_count
         FROM audit_ledger
         WHERE tenant_id = ? AND action = 'payment:settled_fifo'
           AND datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)
           AND json_extract(payload, '$.orderId') IN
               (SELECT id FROM orders WHERE tenant_id = ? AND table_id = ?)",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .bind(tenant_id)
    .bind(&counter_point)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let total_revenue_cents: i64 = row.try_get("revenue").map_err(|e| e.to_string())?;
    let total_orders: i64 = row.try_get("order_count").map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT COALESCE(json_extract(payload, '$.method'), 'Bilinmiyor') AS method,
                COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0) AS amount
         FROM audit_ledger
         WHERE tenant_id = ? AND action = 'payment:settled_fifo'
           AND datetime(timestamp) >= datetime(?) AND datetime(timestamp) < datetime(?)
           AND json_extract(payload, '$.orderId') IN
               (SELECT id FROM orders WHERE tenant_id = ? AND table_id = ?)
         GROUP BY method ORDER BY amount DESC",
    )
    .bind(tenant_id)
    .bind(&range.from)
    .bind(&range.to)
    .bind(tenant_id)
    .bind(&counter_point)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut payment_methods = Vec::with_capacity(rows.len());
    for row in rows {
        payment_methods.push(CounterPaymentShareDto {
            method: row.try_get("method").map_err(|e| e.to_string())?,
            amount_cents: row.try_get("amount").map_err(|e| e.to_string())?,
        });
    }

    Ok(CounterSalesDto {
        total_revenue_cents,
        total_orders,
        average_order_value_cents: if total_orders > 0 {
            total_revenue_cents / total_orders
        } else {
            0
        },
        payment_methods,
    })
}

#[cfg(test)]
#[path = "counter_sales_tests.rs"]
mod tests;
