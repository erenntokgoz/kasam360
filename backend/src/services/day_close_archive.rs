//! Gün sonu arşivi: kapatılmış geçmiş günlerin listesi ve dökümü.
//!
//! Neden denetim defteri: `close_day` kapanışı `day:closed` kaydıyla mühürler;
//! o kaydın sıra numarası iki kapanış arasındaki dönemi kesin belirler. Tahsilat
//! dağılımı bu sıra aralığından, kasa hareketi ve vardiyalar zaman aralığından
//! okunur. Servis yalnız `SELECT` yapar ve her sorgu `tenant_id` ile daraltılır.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

/// Vardiya kapanışı kapanış kaydından önce, saniye kesirsiz `datetime('now')` ile
/// yazılır; kayıt zamanı kesirli olduğundan uç değere pay bırakılır.
const SHIFT_CLOSE_SLACK: &str = "+5 seconds";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DayCloseRow {
    pub id: String,
    pub closed_at: String,
    pub closed_by_id: String,
    pub closed_by_name: Option<String>,
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub closed_shifts_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DayCloseShift {
    pub shift_id: String,
    pub cashier_name: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub expected_cents: i64,
    pub actual_cents: Option<i64>,
    pub difference_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCloseDetail {
    pub header: DayCloseRow,
    /// Dönemin başlangıcı: bir önceki kapanış anı; ilk kapanışta `None`.
    pub period_start: Option<String>,
    pub cash_cents: i64,
    pub card_cents: i64,
    pub meal_card_cents: i64,
    pub veresiye_cents: i64,
    pub refund_cents: i64,
    pub cash_in_cents: i64,
    pub cash_out_cents: i64,
    pub shifts: Vec<DayCloseShift>,
}

fn read_header(row: &sqlx::sqlite::SqliteRow) -> Result<DayCloseRow, String> {
    let count = |name: &str| {
        row.try_get::<Option<i64>, _>(name)
            .map_err(|e| e.to_string())
    };
    Ok(DayCloseRow {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        closed_at: row.try_get("closed_at").map_err(|e| e.to_string())?,
        closed_by_id: row.try_get("actor_id").map_err(|e| e.to_string())?,
        closed_by_name: row.try_get("actor_name").map_err(|e| e.to_string())?,
        // Eski kayıtlarda alan yoksa sıfır uydurulmaz; alan yoksa kayıt bozuktur.
        total_revenue_cents: count("revenue")?
            .ok_or_else(|| "gün sonu kaydında ciro alanı eksik".to_string())?,
        total_orders: count("orders")?
            .ok_or_else(|| "gün sonu kaydında adisyon sayısı eksik".to_string())?,
        closed_shifts_count: count("shifts")?
            .ok_or_else(|| "gün sonu kaydında vardiya sayısı eksik".to_string())?,
    })
}

const HEADER_SELECT: &str = "SELECT l.id, l.sequence, l.timestamp AS closed_at, l.actor_id, \
        u.name AS actor_name, \
        CAST(json_extract(l.payload, '$.totalRevenueCents') AS INTEGER) AS revenue, \
        CAST(json_extract(l.payload, '$.totalOrders') AS INTEGER) AS orders, \
        CAST(json_extract(l.payload, '$.closedShiftsCount') AS INTEGER) AS shifts \
     FROM audit_ledger l LEFT JOIN users u ON u.id = l.actor_id AND u.tenant_id = l.tenant_id \
     WHERE l.tenant_id = ? AND l.action = 'day:closed'";

/// Kapatılmış günler, en yeni üstte.
pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    limit: i64,
) -> Result<Vec<DayCloseRow>, String> {
    let rows = sqlx::query(&format!("{HEADER_SELECT} ORDER BY l.sequence DESC LIMIT ?"))
        .bind(tenant_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    rows.iter().map(read_header).collect()
}

async fn sum_cents(
    conn: &mut SqliteConnection,
    sql: &str,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(sql)
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())
}

/// Tek kapanışın dökümü; başka kiracının veya `day:closed` olmayan kayıt için `None`.
pub async fn detail(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    close_id: &str,
) -> Result<Option<DayCloseDetail>, String> {
    let Some(row) = sqlx::query(&format!("{HEADER_SELECT} AND l.id = ?"))
        .bind(tenant_id)
        .bind(close_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let header = read_header(&row)?;
    let sequence: i64 = row.try_get("sequence").map_err(|e| e.to_string())?;

    let previous = sqlx::query(
        "SELECT sequence, timestamp FROM audit_ledger \
         WHERE tenant_id = ? AND action = 'day:closed' AND sequence < ? \
         ORDER BY sequence DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(sequence)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let (prev_sequence, period_start) = match &previous {
        Some(prev) => (
            prev.try_get::<i64, _>("sequence")
                .map_err(|e| e.to_string())?,
            Some(
                prev.try_get::<String, _>("timestamp")
                    .map_err(|e| e.to_string())?,
            ),
        ),
        None => (0, None),
    };
    let from = period_start
        .clone()
        .unwrap_or_else(|| "1970-01-01T00:00:00+00:00".to_string());

    // Tahsilat dağılımı sıra aralığından okunur: iki kapanış arasındaki her
    // tahsilat tam bir kez, hangi saniyede yazıldığından bağımsız sayılır.
    let channels = sqlx::query(
        "SELECT \
            COALESCE(SUM(CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER)), 0) AS cash, \
            COALESCE(SUM(CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER)), 0) AS card, \
            COALESCE(SUM(CAST(json_extract(payload, '$.mealCardAmountCents') AS INTEGER)), 0) AS meal, \
            COALESCE(SUM(CAST(json_extract(payload, '$.veresiyeAmountCents') AS INTEGER)), 0) AS veresiye \
         FROM audit_ledger \
         WHERE tenant_id = ? AND action = 'payment:settled_fifo' AND sequence > ? AND sequence < ?",
    )
    .bind(tenant_id)
    .bind(prev_sequence)
    .bind(sequence)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let window = format!("datetime(created_at) > datetime(?2) AND datetime(created_at) <= datetime(?3, '{SHIFT_CLOSE_SLACK}')");
    let refund_cents = sum_cents(
        conn,
        &format!(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM refunds WHERE tenant_id = ?1 AND {window}"
        ),
        tenant_id,
        &from,
        &header.closed_at,
    )
    .await?;
    let cash_in_cents = sum_cents(
        conn,
        &format!(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements \
             WHERE tenant_id = ?1 AND movement_type = 'IN' AND {window}"
        ),
        tenant_id,
        &from,
        &header.closed_at,
    )
    .await?;
    let cash_out_cents = sum_cents(
        conn,
        &format!(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements \
             WHERE tenant_id = ?1 AND movement_type = 'OUT' AND {window}"
        ),
        tenant_id,
        &from,
        &header.closed_at,
    )
    .await?;

    let shift_rows = sqlx::query(
        "SELECT s.id, u.name AS cashier_name, s.opened_at, s.closed_at, \
                s.expected_amount_cents, s.actual_amount_cents, s.difference_cents \
         FROM shifts s LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id \
         WHERE s.tenant_id = ?1 AND s.status = 'CLOSED' \
           AND datetime(s.closed_at) > datetime(?2) \
           AND datetime(s.closed_at) <= datetime(?3, ?4) \
         ORDER BY datetime(s.opened_at), s.id",
    )
    .bind(tenant_id)
    .bind(&from)
    .bind(&header.closed_at)
    .bind(SHIFT_CLOSE_SLACK)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let shifts = shift_rows
        .iter()
        .map(|r| {
            Ok(DayCloseShift {
                shift_id: r.try_get("id").map_err(|e| e.to_string())?,
                cashier_name: r.try_get("cashier_name").map_err(|e| e.to_string())?,
                opened_at: r.try_get("opened_at").map_err(|e| e.to_string())?,
                closed_at: r.try_get("closed_at").map_err(|e| e.to_string())?,
                expected_cents: r
                    .try_get("expected_amount_cents")
                    .map_err(|e| e.to_string())?,
                actual_cents: r
                    .try_get("actual_amount_cents")
                    .map_err(|e| e.to_string())?,
                difference_cents: r.try_get("difference_cents").map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(Some(DayCloseDetail {
        header,
        period_start,
        cash_cents: channels.try_get("cash").map_err(|e| e.to_string())?,
        card_cents: channels.try_get("card").map_err(|e| e.to_string())?,
        meal_card_cents: channels.try_get("meal").map_err(|e| e.to_string())?,
        veresiye_cents: channels.try_get("veresiye").map_err(|e| e.to_string())?,
        refund_cents,
        cash_in_cents,
        cash_out_cents,
        shifts,
    }))
}

#[cfg(test)]
#[path = "day_close_archive_tests.rs"]
mod tests;
