//! Paket servis raporu: ciro, ödeme şekli, kurye başına teslim sayısı ve süresi, iptaller.
//!
//! Ciro teslim anına göre sayılır (iptal edilen sipariş ciroya girmez). Süreler tam saniye
//! olarak türetilir; ondalık hesap yoktur.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use super::text_error;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MethodShare {
    pub method: String,
    pub order_count: i64,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CourierStat {
    pub courier_id: String,
    pub name: String,
    pub delivered_count: i64,
    pub amount_cents: i64,
    /// Yola çıkıştan teslime ortalama süre; ölçülemiyorsa boş.
    pub average_trip_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReport {
    pub delivered_count: i64,
    pub revenue_cents: i64,
    pub fee_cents: i64,
    pub cancelled_count: i64,
    pub cancelled_cents: i64,
    /// Siparişten teslime ortalama süre.
    pub average_total_seconds: Option<i64>,
    pub methods: Vec<MethodShare>,
    pub couriers: Vec<CourierStat>,
}

fn seconds_between(start: Option<String>, end: Option<String>) -> Option<i64> {
    let parse = |value: &str| chrono::DateTime::parse_from_rfc3339(value).ok();
    let (start, end) = (parse(start.as_deref()?)?, parse(end.as_deref()?)?);
    let seconds = (end - start).num_seconds();
    (seconds >= 0).then_some(seconds)
}

fn average(values: &[i64]) -> Option<i64> {
    let count = i64::try_from(values.len())
        .ok()
        .filter(|count| *count > 0)?;
    let sum = values
        .iter()
        .try_fold(0_i64, |acc, v| acc.checked_add(*v))?;
    Some(sum / count)
}

pub async fn report(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<DeliveryReport, String> {
    let delivered = sqlx::query(
        "SELECT d.payment_method, d.courier_id, d.fee_cents, d.created_at, d.dispatched_at,
                d.delivered_at, o.total_cents,
                (SELECT u.name FROM users u WHERE u.id = d.courier_id AND u.tenant_id = d.tenant_id) AS courier_name
         FROM delivery_orders d JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
         WHERE d.tenant_id = ? AND d.status = 'DELIVERED'
           AND datetime(d.delivered_at) >= datetime(?) AND datetime(d.delivered_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    let mut report = DeliveryReport {
        delivered_count: 0,
        revenue_cents: 0,
        fee_cents: 0,
        cancelled_count: 0,
        cancelled_cents: 0,
        average_total_seconds: None,
        methods: Vec::new(),
        couriers: Vec::new(),
    };
    let overflow = || "OVERFLOW: rapor toplamı taştı".to_string();
    let mut totals: Vec<i64> = Vec::new();
    // Kurye kimliği, adı, adet, tutar ve yolculuk süreleri.
    let mut per_courier: Vec<(String, String, i64, i64, Vec<i64>)> = Vec::new();

    for row in &delivered {
        let total: i64 = row.try_get("total_cents").map_err(text_error)?;
        let fee: i64 = row.try_get("fee_cents").map_err(text_error)?;
        let method: String = row.try_get("payment_method").map_err(text_error)?;
        report.delivered_count += 1;
        report.revenue_cents = report
            .revenue_cents
            .checked_add(total)
            .ok_or_else(overflow)?;
        report.fee_cents = report.fee_cents.checked_add(fee).ok_or_else(overflow)?;
        match report
            .methods
            .iter_mut()
            .find(|share| share.method == method)
        {
            Some(share) => {
                share.order_count += 1;
                share.amount_cents = share.amount_cents.checked_add(total).ok_or_else(overflow)?;
            }
            None => report.methods.push(MethodShare {
                method,
                order_count: 1,
                amount_cents: total,
            }),
        }
        let created: String = row.try_get("created_at").map_err(text_error)?;
        let delivered_at: Option<String> = row.try_get("delivered_at").map_err(text_error)?;
        if let Some(seconds) = seconds_between(Some(created), delivered_at.clone()) {
            totals.push(seconds);
        }
        let courier: Option<String> = row.try_get("courier_id").map_err(text_error)?;
        if let Some(courier) = courier {
            let name: Option<String> = row.try_get("courier_name").map_err(text_error)?;
            let dispatched: Option<String> = row.try_get("dispatched_at").map_err(text_error)?;
            let trip = seconds_between(dispatched, delivered_at);
            let slot = match per_courier.iter().position(|entry| entry.0 == courier) {
                Some(index) => &mut per_courier[index],
                None => {
                    per_courier.push((
                        courier.clone(),
                        name.unwrap_or_else(|| courier.clone()),
                        0,
                        0,
                        Vec::new(),
                    ));
                    let last = per_courier.len() - 1;
                    &mut per_courier[last]
                }
            };
            slot.2 += 1;
            slot.3 = slot.3.checked_add(total).ok_or_else(overflow)?;
            if let Some(trip) = trip {
                slot.4.push(trip);
            }
        }
    }
    report.average_total_seconds = average(&totals);
    report
        .methods
        .sort_by_key(|share| std::cmp::Reverse(share.amount_cents));
    report.couriers = per_courier
        .into_iter()
        .map(
            |(courier_id, name, delivered_count, amount_cents, trips)| CourierStat {
                courier_id,
                name,
                delivered_count,
                amount_cents,
                average_trip_seconds: average(&trips),
            },
        )
        .collect();
    report
        .couriers
        .sort_by_key(|stat| std::cmp::Reverse(stat.delivered_count));

    let cancelled = sqlx::query(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(o.total_cents), 0) AS cents
         FROM delivery_orders d JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
         WHERE d.tenant_id = ? AND d.status = 'CANCELLED'
           AND datetime(d.cancelled_at) >= datetime(?) AND datetime(d.cancelled_at) < datetime(?)",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    report.cancelled_count = cancelled.try_get("cnt").map_err(text_error)?;
    report.cancelled_cents = cancelled.try_get("cents").map_err(text_error)?;
    Ok(report)
}
