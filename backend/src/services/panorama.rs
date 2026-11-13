//! Yönetim panosunun tek veri kaynağı.
//!
//! Neden ayrı servis: eski rapor sorguları adisyon toplamını ciro sayıyordu ve saatleri
//! UTC gruplanıyordu; indirimli satışta ciro şişiyor, akşam satışı öğlene düşüyordu. Pano
//! tahsil edilen parayı denetim defterinden okur. Kâr KDV hariçtir: KDV işletmenin değil
//! devletin parasıdır, ciroya dahil kâr gösterilirse patron olmayan parayı kâr sanır.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use super::panorama_hourly::hourly;
pub use super::panorama_hourly::HourSales;

const TOP_PRODUCT_LIMIT: i64 = 8;
const MAX_DAY_BUCKETS: i64 = 92;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Kpi {
    pub collected_cents: i64,
    pub orders: i64,
    pub average_ticket_cents: i64,
    pub refund_cents: i64,
    pub discount_cents: i64,
    pub void_cents: i64,
    pub vat_cents: i64,
    /// Yalnız patrona dolar; müdür kâr ve maliyet görmez.
    pub cogs_cents: Option<i64>,
    pub gross_profit_cents: Option<i64>,
    /// Parti girişi olmayan satış varsa kâr gerçeğinden yüksek görünür; ekran söyler.
    pub cost_incomplete: bool,
    /// Partisiz düşüm taşıyan tahsilat sayısı; kâr bu yüzden yaklaşık gösterilir.
    pub cost_missing_sales: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub label: String,
    pub current_cents: i64,
    pub previous_cents: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelShare {
    pub channel: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProductRow {
    pub product_id: String,
    pub name: String,
    pub units: i64,
    pub revenue_cents: i64,
    /// Maliyeti bilinmeyen üründe boştur; sıfır kâr gibi gösterilmez.
    pub profit_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub open_tables: i64,
    pub total_tables: i64,
    pub open_orders: i64,
    pub open_order_cents: i64,
    pub longest_open_minutes: i64,
    pub kitchen_waiting: i64,
    pub shift_open: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Panorama {
    pub current: Kpi,
    pub previous: Kpi,
    /// `HOUR` veya `DAY`.
    pub bucket_kind: &'static str,
    pub buckets: Vec<Bucket>,
    /// Her zaman 24 satır; satışsız saat de sıfırla döner.
    pub hourly: Vec<HourSales>,
    pub channels: Vec<ChannelShare>,
    pub products: Vec<ProductRow>,
    pub live: LiveState,
}

/// Dönem: RFC 3339 yarı açık aralık `[from, to)`; istemcinin yerel ofseti gün kovalarını belirler.
pub struct Period<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub offset: &'a str,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

pub(crate) const PAYMENTS: &str = "FROM audit_ledger
    WHERE tenant_id = ?1 AND action = 'payment:settled_fifo'
      AND datetime(timestamp) >= datetime(?2) AND datetime(timestamp) < datetime(?3)";

/// Dönemde kapanan adisyonlar. Kısmi ödemesi süren adisyonun kâr ve KDV'si kapanınca sayılır.
fn closed_orders() -> String {
    format!("SELECT json_extract(payload, '$.orderId') {PAYMENTS} AND json_extract(payload, '$.orderClosed') = 1")
}

async fn kpi(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
) -> Result<Kpi, String> {
    let money = sqlx::query(&format!(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0) AS collected,
                COALESCE(SUM(CAST(json_extract(payload, '$.discountCents') AS INTEGER)), 0) AS discount,
                COALESCE(SUM(CAST(json_extract(payload, '$.cogsTotalCents') AS INTEGER)), 0) AS cogs,
                COALESCE(SUM(json_extract(payload, '$.orderClosed') = 1), 0) AS orders,
                COALESCE(SUM(COALESCE(json_extract(payload, '$.cogsUntrackedDeficit'), 0) > 0), 0) AS blind
         {PAYMENTS}"
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let collected: i64 = money.try_get("collected").map_err(text_error)?;
    let cogs: i64 = money.try_get("cogs").map_err(text_error)?;
    let orders: i64 = money.try_get("orders").map_err(text_error)?;
    let blind: i64 = money.try_get("blind").map_err(text_error)?;

    let vat: i64 = sqlx::query_scalar(&format!(
        "SELECT COALESCE(SUM(tax_amount_cents), 0) FROM order_items
         WHERE tenant_id = ?1 AND status != 'CANCELLED' AND order_id IN ({})",
        closed_orders()
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let refund: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM refunds
         WHERE tenant_id = ?1 AND datetime(created_at) >= datetime(?2)
           AND datetime(created_at) < datetime(?3)",
    )
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let void: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(COALESCE(json_extract(payload, '$.amountCents'),
                                           json_extract(payload, '$.orderTotalCents')) AS INTEGER)), 0)
         FROM audit_ledger
         WHERE tenant_id = ?1 AND action IN ('order_item:voided', 'order:voided')
           AND datetime(timestamp) >= datetime(?2) AND datetime(timestamp) < datetime(?3)",
    )
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;

    Ok(Kpi {
        collected_cents: collected,
        orders,
        average_ticket_cents: if orders > 0 { collected / orders } else { 0 },
        refund_cents: refund,
        discount_cents: money.try_get("discount").map_err(text_error)?,
        void_cents: void,
        vat_cents: vat,
        cogs_cents: Some(cogs),
        gross_profit_cents: Some(collected - refund - vat - cogs),
        cost_incomplete: blind > 0,
        cost_missing_sales: blind,
    })
}

async fn bucket_totals(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
    format: &str,
    shift: &str,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let rows = sqlx::query(&format!(
        "SELECT strftime(?4, timestamp, ?5, ?6) AS bucket,
                SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)) AS amount
         {PAYMENTS} GROUP BY bucket"
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .bind(format)
    .bind(period.offset)
    .bind(shift)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            let bucket: Option<String> = row.try_get("bucket").map_err(text_error)?;
            let amount: i64 = row.try_get("amount").map_err(text_error)?;
            Ok((bucket.unwrap_or_default(), amount))
        })
        .collect()
}

fn local_date(moment: &chrono::DateTime<chrono::FixedOffset>, minutes: i64) -> chrono::NaiveDate {
    (moment.naive_utc() + chrono::Duration::minutes(minutes)).date()
}

/// Bir günlük dönem saatlere, daha uzunu günlere bölünür. Boş kova da döner: satışsız saat
/// grafikten silinirse yoğunluk olduğundan sıkışık görünür.
async fn buckets(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
    previous: &Period<'_>,
    span_seconds: i64,
    compare_seconds: i64,
    offset_minutes: i64,
) -> Result<(&'static str, Vec<Bucket>), String> {
    let hourly = span_seconds < 86_400;
    let format = if hourly { "%H" } else { "%Y-%m-%d" };
    let shift = format!("+{compare_seconds} seconds");
    let current = bucket_totals(conn, tenant, period, format, "+0 seconds").await?;
    let earlier = bucket_totals(conn, tenant, previous, format, &shift).await?;
    let labels: Vec<String> = if hourly {
        (0..24).map(|hour| format!("{hour:02}")).collect()
    } else {
        let parse = |text: &str| {
            chrono::DateTime::parse_from_rfc3339(text)
                .map_err(|e| format!("VALIDATION: tarih: {e}"))
        };
        let first = local_date(&parse(period.from)?, offset_minutes);
        let last = local_date(
            &(parse(period.to)? - chrono::Duration::nanoseconds(1)),
            offset_minutes,
        );
        (0..=(last - first).num_days().min(MAX_DAY_BUCKETS))
            .map(|day| {
                (first + chrono::Duration::days(day))
                    .format("%Y-%m-%d")
                    .to_string()
            })
            .collect()
    };
    let rows = labels
        .into_iter()
        .map(|label| Bucket {
            current_cents: current.get(&label).copied().unwrap_or(0),
            previous_cents: earlier.get(&label).copied().unwrap_or(0),
            label,
        })
        .collect();
    Ok((if hourly { "HOUR" } else { "DAY" }, rows))
}

async fn channels(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
) -> Result<Vec<ChannelShare>, String> {
    let row = sqlx::query(&format!(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER)), 0) AS cash,
                COALESCE(SUM(CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER)), 0) AS card,
                COALESCE(SUM(CAST(json_extract(payload, '$.mealCardAmountCents') AS INTEGER)), 0) AS meal,
                COALESCE(SUM(CAST(json_extract(payload, '$.veresiyeAmountCents') AS INTEGER)), 0) AS credit
         {PAYMENTS}"
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    [
        ("Nakit", "cash"),
        ("Kart", "card"),
        ("Yemek Kartı", "meal"),
        ("Veresiye", "credit"),
    ]
    .into_iter()
    .map(|(channel, column)| {
        Ok(ChannelShare {
            channel: channel.to_string(),
            amount_cents: row.try_get(column).map_err(text_error)?,
        })
    })
    .collect()
}

async fn products(
    conn: &mut SqliteConnection,
    tenant: &str,
    period: &Period<'_>,
) -> Result<Vec<ProductRow>, String> {
    let rows = sqlx::query(&format!(
        "SELECT oi.product_id, COALESCE(p.name, oi.product_id) AS name,
                SUM(oi.quantity) AS units, SUM(oi.total_cents) AS revenue,
                SUM(oi.subtotal_cents) AS net,
                SUM(oi.stock_source_id IS NULL) AS no_source,
                COALESCE(SUM(json_extract(e.payload, '$.untrackedDeficit') > 0), 0) AS blind,
                COALESCE(SUM(CAST(json_extract(e.payload, '$.totalCogsCents') AS INTEGER)
                             * oi.quantity
                             / MAX(CAST(json_extract(e.payload, '$.allocations[0].quantity') AS INTEGER), 1)), 0) AS cost
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
         LEFT JOIN events e ON e.tenant_id = oi.tenant_id AND e.aggregate_id = oi.stock_source_id
                           AND e.event_type = 'FIFO_STOCK_DEDUCTED'
         WHERE oi.tenant_id = ?1 AND oi.status != 'CANCELLED' AND oi.order_id IN ({})
         GROUP BY oi.product_id ORDER BY revenue DESC, units DESC LIMIT {TOP_PRODUCT_LIMIT}",
        closed_orders()
    ))
    .bind(tenant)
    .bind(period.from)
    .bind(period.to)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            let net: i64 = row.try_get("net").map_err(text_error)?;
            let cost: i64 = row.try_get("cost").map_err(text_error)?;
            let blind: i64 = row.try_get("blind").map_err(text_error)?;
            let no_source: i64 = row.try_get("no_source").map_err(text_error)?;
            Ok(ProductRow {
                product_id: row.try_get("product_id").map_err(text_error)?,
                name: row.try_get("name").map_err(text_error)?,
                units: row.try_get("units").map_err(text_error)?,
                revenue_cents: row.try_get("revenue").map_err(text_error)?,
                profit_cents: (blind == 0 && no_source == 0).then_some(net - cost),
            })
        })
        .collect()
}

async fn live(conn: &mut SqliteConnection, tenant: &str) -> Result<LiveState, String> {
    let tables = sqlx::query(
        "SELECT COUNT(*) AS total, COALESCE(SUM(status = 'OCCUPIED'), 0) AS busy
         FROM tables WHERE tenant_id = ?1 AND substr(id, 1, 12) != 'tbl_counter_'",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let orders = sqlx::query(
        "SELECT COUNT(*) AS open_orders, COALESCE(SUM(total_cents), 0) AS amount,
                CAST(COALESCE(MAX((julianday('now') - julianday(created_at)) * 1440), 0) AS INTEGER) AS oldest
         FROM orders WHERE tenant_id = ?1 AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let kitchen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ?1 AND oi.status IN ('Pending', 'Preparing')
           AND o.status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    let shifts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM shifts WHERE tenant_id = ?1 AND status = 'OPEN'")
            .bind(tenant)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
    Ok(LiveState {
        open_tables: tables.try_get("busy").map_err(text_error)?,
        total_tables: tables.try_get("total").map_err(text_error)?,
        open_orders: orders.try_get("open_orders").map_err(text_error)?,
        open_order_cents: orders.try_get("amount").map_err(text_error)?,
        longest_open_minutes: orders.try_get("oldest").map_err(text_error)?,
        kitchen_waiting: kitchen,
        shift_open: shifts > 0,
    })
}

/// Panoyu kurar. Karşılaştırma dönemi aynı aralığın `compare_seconds` öncesidir: gün
/// ortasında bugünü dünün tamamıyla kıyaslamak düşüş varmış gibi gösterirdi.
pub async fn build(
    conn: &mut SqliteConnection,
    tenant: &str,
    from: &str,
    to: &str,
    compare_seconds: i64,
    offset_minutes: i64,
) -> Result<Panorama, String> {
    let parse = |text: &str| {
        chrono::DateTime::parse_from_rfc3339(text)
            .map_err(|_| "VALIDATION: tarih RFC 3339 olmalıdır".to_string())
    };
    let (start, end) = (parse(from)?, parse(to)?);
    if end < start {
        return Err("VALIDATION: bitiş başlangıçtan önce olamaz".to_string());
    }
    if compare_seconds <= 0 {
        return Err("VALIDATION: karşılaştırma aralığı pozitif olmalıdır".to_string());
    }
    // `to` is exclusive, so measure through the final included instant. This keeps
    // a calendar-day selection on the hourly chart even though its SQL bound is
    // midnight at the start of the following day.
    let span = (end - start) - chrono::Duration::nanoseconds(1);
    let back = chrono::Duration::seconds(compare_seconds);
    let earlier_from = (start - back).to_rfc3339();
    let earlier_to = (end - back).to_rfc3339();
    let offset = format!("{offset_minutes:+} minutes");
    let period = Period {
        from,
        to,
        offset: &offset,
    };
    let previous = Period {
        from: &earlier_from,
        to: &earlier_to,
        offset: &offset,
    };
    let span_seconds = span.num_seconds();
    let (bucket_kind, rows) = buckets(
        conn,
        tenant,
        &period,
        &previous,
        span_seconds,
        compare_seconds,
        offset_minutes,
    )
    .await?;
    Ok(Panorama {
        current: kpi(conn, tenant, &period).await?,
        previous: kpi(conn, tenant, &previous).await?,
        bucket_kind,
        buckets: rows,
        hourly: hourly(conn, tenant, &period).await?,
        channels: channels(conn, tenant, &period).await?,
        products: products(conn, tenant, &period).await?,
        live: live(conn, tenant).await?,
    })
}

impl Panorama {
    /// Maliyet ve kâr yetkisi olmayan rol için boşaltır; sıfır yazmak zarar gibi okunurdu.
    pub fn hide_profit(&mut self) {
        for kpi in [&mut self.current, &mut self.previous] {
            kpi.cogs_cents = None;
            kpi.gross_profit_cents = None;
        }
        for product in &mut self.products {
            product.profit_cents = None;
        }
    }
}

#[cfg(test)]
#[path = "panorama_tests.rs"]
mod tests;
