//! Kapanan masalar: ödemesi tamamlanmış adisyonların filtreli listesi ve detayı.
//!
//! Neden denetim defteri: adisyonu kapatan kullanıcı ve kapanış anı `orders`
//! tablosunda tutulmaz; tek doğru kaynak `payment:settled_fifo` kayıtlarıdır.
//! Bu servis yalnız `SELECT` yapar, geçmişi değiştirmez ve her sorgu `tenant_id`
//! ile daraltılır.

use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqliteConnection};

/// Tek sorguda dönebilecek en fazla satır; sınırsız tarama ekranı kilitler.
pub const MAX_LIMIT: i64 = 500;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderFilter {
    /// ISO-8601 başlangıç (dahil). Kapanış anına uygulanır.
    pub from: String,
    /// ISO-8601 bitiş (dahil).
    pub to: String,
    /// `CASH`, `CARD`, `MEAL_CARD` veya `VERESIYE`.
    pub method: Option<String>,
    /// Masa adında geçen metin.
    pub table_search: Option<String>,
    pub opened_by: Option<String>,
    pub closed_by: Option<String>,
    /// `closed_desc` (varsayılan), `closed_asc`, `total_desc`, `total_asc`, `table_asc`.
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderRow {
    pub order_id: String,
    pub table_name: String,
    pub guest_count: i64,
    pub opened_at: String,
    pub closed_at: String,
    pub opened_by_id: Option<String>,
    pub opened_by_name: Option<String>,
    pub closed_by_id: String,
    pub closed_by_name: Option<String>,
    pub order_total_cents: i64,
    pub paid_cents: i64,
    pub cash_cents: i64,
    pub card_cents: i64,
    pub meal_card_cents: i64,
    pub veresiye_cents: i64,
    /// Kapanış fişinin tahsilat kimliği; fiş yeniden yazdırma bu kimlikle yapılır.
    pub last_transaction_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderSummary {
    pub count: i64,
    pub paid_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderList {
    pub rows: Vec<ClosedOrderRow>,
    /// Sayfalamadan bağımsız, filtrenin tamamına ait özet.
    pub summary: ClosedOrderSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderItem {
    pub product_name: String,
    pub quantity: i64,
    pub total_cents: i64,
    pub is_comp: bool,
    pub voided: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderPayment {
    pub transaction_id: String,
    pub method: String,
    pub amount_cents: i64,
    pub actor_name: Option<String>,
    pub paid_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderRefund {
    pub amount_cents: i64,
    pub method: String,
    pub reason: String,
    pub actor_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderVoid {
    pub kind: String,
    pub reason: String,
    pub amount_cents: i64,
    pub actor_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrderDetail {
    pub header: ClosedOrderRow,
    pub items: Vec<ClosedOrderItem>,
    pub payments: Vec<ClosedOrderPayment>,
    pub refunds: Vec<ClosedOrderRefund>,
    pub voids: Vec<ClosedOrderVoid>,
}

/// Adisyon başına tahsilat toplamı ve kapanış (son) tahsilat kaydı.
///
/// Neden `sequence` ile eşleme: son tahsilat kapanışı yapan kayıttır; zaman
/// damgası aynı saniyede çakışabilir, sıra numarası çakışmaz.
const BASE: &str = "SELECT o.id AS order_id, COALESCE(t.name, o.table_id) AS table_name, \
        o.guest_count, o.created_at AS opened_at, l.timestamp AS closed_at, \
        o.cashier_id AS opened_by_id, ou.name AS opened_by_name, \
        l.actor_id AS closed_by_id, cu.name AS closed_by_name, o.total_cents AS order_total_cents, \
        pay.paid AS paid_cents, pay.cash AS cash_cents, pay.card AS card_cents, \
        pay.meal AS meal_card_cents, pay.veresiye AS veresiye_cents, \
        COALESCE(json_extract(l.payload, '$.transactionId'), l.resource_id) AS last_transaction_id \
     FROM orders o \
     JOIN (SELECT json_extract(payload, '$.orderId') AS order_id, \
                  SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)) AS paid, \
                  SUM(COALESCE(CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER), 0)) AS cash, \
                  SUM(COALESCE(CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER), 0)) AS card, \
                  SUM(COALESCE(CAST(json_extract(payload, '$.mealCardAmountCents') AS INTEGER), 0)) AS meal, \
                  SUM(COALESCE(CAST(json_extract(payload, '$.veresiyeAmountCents') AS INTEGER), 0)) AS veresiye, \
                  MAX(sequence) AS last_seq \
           FROM audit_ledger WHERE tenant_id = ";

const BASE_TAIL: &str =
    " AND action = 'payment:settled_fifo' GROUP BY order_id) pay ON pay.order_id = o.id \
     JOIN audit_ledger l ON l.sequence = pay.last_seq AND l.tenant_id = o.tenant_id \
     LEFT JOIN tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id \
     LEFT JOIN users ou ON ou.id = o.cashier_id AND ou.tenant_id = o.tenant_id \
     LEFT JOIN users cu ON cu.id = l.actor_id AND cu.tenant_id = o.tenant_id \
     WHERE o.tenant_id = ";

/// Yalnız tahsilatı tamamlanmış adisyonlar; kısmi ödemede açık kalan masa listede olmaz.
const STATUS_FILTER: &str = " AND o.status IN ('PAID', 'COMPENSATED')";

fn clean(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

/// Filtre koşulları liste ve özet sorgusunda aynıdır; sapma özetin listeyle
/// çelişmesine yol açardı.
fn push_filter<'a>(
    query: &mut QueryBuilder<'a, Sqlite>,
    filter: &'a ClosedOrderFilter,
) -> Result<(), String> {
    query
        .push(STATUS_FILTER)
        .push(") WHERE datetime(closed_at) >= datetime(")
        .push_bind(&filter.from)
        .push(") AND datetime(closed_at) <= datetime(")
        .push_bind(&filter.to)
        .push(")");
    if let Some(method) = clean(filter.method.as_deref()) {
        let column = match method {
            "CASH" => "cash_cents",
            "CARD" => "card_cents",
            "MEAL_CARD" => "meal_card_cents",
            "VERESIYE" => "veresiye_cents",
            _ => return Err("INVALID_ARGUMENT: ödeme yöntemi geçersiz".to_string()),
        };
        query.push(format!(" AND {column} > 0"));
    }
    if let Some(text) = clean(filter.table_search.as_deref()) {
        query
            .push(" AND instr(lower(table_name), lower(")
            .push_bind(text)
            .push(")) > 0");
    }
    if let Some(user) = clean(filter.opened_by.as_deref()) {
        query.push(" AND opened_by_id = ").push_bind(user);
    }
    if let Some(user) = clean(filter.closed_by.as_deref()) {
        query.push(" AND closed_by_id = ").push_bind(user);
    }
    Ok(())
}

fn order_clause(sort: Option<&str>) -> Result<&'static str, String> {
    match clean(sort).unwrap_or("closed_desc") {
        "closed_desc" => Ok(" ORDER BY datetime(closed_at) DESC, order_id DESC"),
        "closed_asc" => Ok(" ORDER BY datetime(closed_at) ASC, order_id ASC"),
        "total_desc" => Ok(" ORDER BY paid_cents DESC, order_id DESC"),
        "total_asc" => Ok(" ORDER BY paid_cents ASC, order_id ASC"),
        "table_asc" => Ok(" ORDER BY lower(table_name) ASC, order_id ASC"),
        _ => Err("INVALID_ARGUMENT: sıralama geçersiz".to_string()),
    }
}

fn read_row(row: &sqlx::sqlite::SqliteRow) -> Result<ClosedOrderRow, String> {
    let text = |name: &str| row.try_get::<String, _>(name).map_err(|e| e.to_string());
    let optional = |name: &str| {
        row.try_get::<Option<String>, _>(name)
            .map_err(|e| e.to_string())
    };
    let cents = |name: &str| row.try_get::<i64, _>(name).map_err(|e| e.to_string());
    Ok(ClosedOrderRow {
        order_id: text("order_id")?,
        table_name: text("table_name")?,
        guest_count: cents("guest_count")?,
        opened_at: text("opened_at")?,
        closed_at: text("closed_at")?,
        opened_by_id: optional("opened_by_id")?,
        opened_by_name: optional("opened_by_name")?,
        closed_by_id: text("closed_by_id")?,
        closed_by_name: optional("closed_by_name")?,
        order_total_cents: cents("order_total_cents")?,
        paid_cents: cents("paid_cents")?,
        cash_cents: cents("cash_cents")?,
        card_cents: cents("card_cents")?,
        meal_card_cents: cents("meal_card_cents")?,
        veresiye_cents: cents("veresiye_cents")?,
        last_transaction_id: text("last_transaction_id")?,
    })
}

/// Filtreye uyan kapanmış adisyonlar ve filtrenin tamamına ait özet.
pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    filter: &ClosedOrderFilter,
) -> Result<ClosedOrderList, String> {
    let order = order_clause(filter.sort.as_deref())?;
    let limit = filter.limit.unwrap_or(200).clamp(1, MAX_LIMIT);
    let offset = filter.offset.unwrap_or(0).max(0);

    let mut rows_query = QueryBuilder::<Sqlite>::new("SELECT * FROM (");
    rows_query.push(BASE).push_bind(tenant_id).push(BASE_TAIL);
    rows_query.push_bind(tenant_id);
    push_filter(&mut rows_query, filter)?;
    rows_query.push(order);
    rows_query.push(" LIMIT ").push_bind(limit);
    rows_query.push(" OFFSET ").push_bind(offset);
    let rows = rows_query
        .build()
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut sum_query = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(paid_cents), 0) AS total FROM (",
    );
    sum_query.push(BASE).push_bind(tenant_id).push(BASE_TAIL);
    sum_query.push_bind(tenant_id);
    push_filter(&mut sum_query, filter)?;
    let sum = sum_query
        .build()
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ClosedOrderList {
        rows: rows.iter().map(read_row).collect::<Result<_, _>>()?,
        summary: ClosedOrderSummary {
            count: sum.try_get("cnt").map_err(|e| e.to_string())?,
            paid_cents: sum.try_get("total").map_err(|e| e.to_string())?,
        },
    })
}

/// Tek adisyonun kalem, tahsilat, iade ve iptal dökümü; başka kiracının
/// adisyonu için `None`.
pub async fn detail(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Option<ClosedOrderDetail>, String> {
    let mut query = QueryBuilder::<Sqlite>::new("SELECT * FROM (");
    query.push(BASE).push_bind(tenant_id).push(BASE_TAIL);
    query.push_bind(tenant_id).push(STATUS_FILTER);
    query.push(") WHERE order_id = ").push_bind(order_id);
    let Some(row) = query
        .build()
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let header = read_row(&row)?;

    let items = sqlx::query(
        "SELECT COALESCE(p.name, oi.product_id) AS name, oi.quantity, oi.total_cents, \
                oi.is_comp, oi.status \
         FROM order_items oi \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id \
         WHERE oi.tenant_id = ? AND oi.order_id = ? ORDER BY oi.id",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|r| {
        let status: String = r.try_get("status").map_err(|e| e.to_string())?;
        Ok(ClosedOrderItem {
            product_name: r.try_get("name").map_err(|e| e.to_string())?,
            quantity: r.try_get("quantity").map_err(|e| e.to_string())?,
            total_cents: r.try_get("total_cents").map_err(|e| e.to_string())?,
            is_comp: r.try_get::<i64, _>("is_comp").map_err(|e| e.to_string())? != 0,
            voided: status.eq_ignore_ascii_case("cancelled"),
        })
    })
    .collect::<Result<Vec<_>, String>>()?;

    let payments = sqlx::query(
        "SELECT json_extract(l.payload, '$.transactionId') AS txn, \
                COALESCE(json_extract(l.payload, '$.method'), '') AS method, \
                CAST(json_extract(l.payload, '$.totalAmount') AS INTEGER) AS amount, \
                u.name AS actor_name, l.timestamp AS paid_at \
         FROM audit_ledger l LEFT JOIN users u ON u.id = l.actor_id AND u.tenant_id = l.tenant_id \
         WHERE l.tenant_id = ? AND l.action = 'payment:settled_fifo' \
           AND json_extract(l.payload, '$.orderId') = ? ORDER BY l.sequence",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|r| {
        Ok(ClosedOrderPayment {
            transaction_id: r.try_get("txn").map_err(|e| e.to_string())?,
            method: r.try_get("method").map_err(|e| e.to_string())?,
            amount_cents: r.try_get("amount").map_err(|e| e.to_string())?,
            actor_name: r.try_get("actor_name").map_err(|e| e.to_string())?,
            paid_at: r.try_get("paid_at").map_err(|e| e.to_string())?,
        })
    })
    .collect::<Result<Vec<_>, String>>()?;

    let refunds = sqlx::query(
        "SELECT r.amount_cents, r.method, r.reason, u.name AS actor_name, r.created_at \
         FROM refunds r LEFT JOIN users u ON u.id = r.actor_id AND u.tenant_id = r.tenant_id \
         WHERE r.tenant_id = ? AND r.original_order_id = ? ORDER BY r.created_at, r.id",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|r| {
        Ok(ClosedOrderRefund {
            amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
            method: r.try_get("method").map_err(|e| e.to_string())?,
            reason: r.try_get("reason").map_err(|e| e.to_string())?,
            actor_name: r.try_get("actor_name").map_err(|e| e.to_string())?,
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        })
    })
    .collect::<Result<Vec<_>, String>>()?;

    let voids = sqlx::query(
        "SELECT l.action, COALESCE(json_extract(l.payload, '$.reason'), '') AS reason, \
                COALESCE(CAST(json_extract(l.payload, '$.amountCents') AS INTEGER), 0) AS amount, \
                u.name AS actor_name, l.timestamp AS at \
         FROM audit_ledger l LEFT JOIN users u ON u.id = l.actor_id AND u.tenant_id = l.tenant_id \
         WHERE l.tenant_id = ? AND l.action IN ('order_item:voided', 'order:voided') \
           AND (l.resource_id = ? OR json_extract(l.payload, '$.orderId') = ?) \
         ORDER BY l.sequence",
    )
    .bind(tenant_id)
    .bind(order_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .iter()
    .map(|r| {
        let action: String = r.try_get("action").map_err(|e| e.to_string())?;
        Ok(ClosedOrderVoid {
            kind: if action == "order:voided" {
                "ORDER".to_string()
            } else {
                "ITEM".to_string()
            },
            reason: r.try_get("reason").map_err(|e| e.to_string())?,
            amount_cents: r.try_get("amount").map_err(|e| e.to_string())?,
            actor_name: r.try_get("actor_name").map_err(|e| e.to_string())?,
            created_at: r.try_get("at").map_err(|e| e.to_string())?,
        })
    })
    .collect::<Result<Vec<_>, String>>()?;

    Ok(Some(ClosedOrderDetail {
        header,
        items,
        payments,
        refunds,
        voids,
    }))
}

#[cfg(test)]
#[path = "closed_orders_tests.rs"]
mod tests;
