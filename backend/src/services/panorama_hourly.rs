//! Panonun saatlik tahsilat dağılımı.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use super::panorama::{Period, PAYMENTS};

/// Seçili dönemin tüm günleri üst üste, yerel saate göre tahsilat dağılımı.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HourSales {
    pub hour: i64,
    pub collected_cents: i64,
    pub orders: i64,
}

/// Saat, tahsilat anına ve istemcinin yerel ofsetine göre belirlenir; UTC gruplansa akşam
/// satışı öğlene düşerdi. Satışsız saat 0 yazılır, çünkü boş saat de dağılımın parçasıdır.
pub(crate) async fn hourly(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
) -> Result<Vec<HourSales>, String> {
    let rows = sqlx::query(&format!(
        "SELECT CAST(strftime('%H', timestamp, ?4) AS INTEGER) AS hour,
                SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)) AS amount,
                COALESCE(SUM(json_extract(payload, '$.orderClosed') = 1), 0) AS orders
         {PAYMENTS} GROUP BY hour"
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .bind(period.offset)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut by_hour = std::collections::HashMap::new();
    for row in &rows {
        let hour: i64 = row.try_get("hour").map_err(|e| e.to_string())?;
        let amount: i64 = row.try_get("amount").map_err(|e| e.to_string())?;
        let orders: i64 = row.try_get("orders").map_err(|e| e.to_string())?;
        by_hour.insert(hour, (amount, orders));
    }
    Ok((0..24)
        .map(|hour| {
            let (collected_cents, orders) = by_hour.get(&hour).copied().unwrap_or((0, 0));
            HourSales {
                hour,
                collected_cents,
                orders,
            }
        })
        .collect())
}
