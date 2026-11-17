//! Kapanmış adisyondan e-Adisyon belge modeli kurar.
//!
//! Neden yalnız `PAID` adisyon: açık adisyonun kalemleri ve toplamı değişebilir; belge
//! kapanış anındaki mühürlenmiş tutarlardan (`frozen` kalem toplamları) üretilir.
//! Kapanış zamanı ve kasiyer, orders tablosunda tutulmadığı için denetim defterindeki
//! son `payment:settled_fifo` kaydından okunur.

use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::{Row, SqliteConnection};

use super::model::{AdisyonDocument, DocumentLine, PaymentLine, Supplier};

/// SQLite `CURRENT_TIMESTAMP` (UTC, boşluklu) ve RFC 3339 biçimlerini UTC'ye çevirir.
pub(crate) fn parse_time(value: &str) -> Result<DateTime<Utc>, String> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map(|naive| naive.and_utc())
        .map_err(|_| format!("zaman damgası okunamadı: {value}"))
}

struct PaymentTotals {
    cash: i64,
    card: i64,
    meal_card: i64,
    credit: i64,
    paid: i64,
    closed_at: String,
    cashier_name: String,
}

async fn load_payments(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<PaymentTotals, String> {
    let rows = sqlx::query(
        "SELECT json_extract(l.payload, '$.totalAmount') AS paid, \
                COALESCE(json_extract(l.payload, '$.cashAmountCents'), 0) AS cash, \
                COALESCE(json_extract(l.payload, '$.cardAmountCents'), 0) AS card, \
                COALESCE(json_extract(l.payload, '$.mealCardAmountCents'), 0) AS meal, \
                COALESCE(json_extract(l.payload, '$.veresiyeAmountCents'), 0) AS credit, \
                l.timestamp AS paid_at, COALESCE(u.name, l.actor_id) AS actor_name \
         FROM audit_ledger l LEFT JOIN users u ON u.id = l.actor_id AND u.tenant_id = l.tenant_id \
         WHERE l.tenant_id = ? AND l.action = 'payment:settled_fifo' \
           AND json_extract(l.payload, '$.orderId') = ? ORDER BY l.sequence",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some(last) = rows.last() else {
        return Err("CONFLICT: adisyonun tahsilat kaydı yok".to_string());
    };
    let mut totals = PaymentTotals {
        cash: 0,
        card: 0,
        meal_card: 0,
        credit: 0,
        paid: 0,
        closed_at: last.try_get("paid_at").map_err(|e| e.to_string())?,
        cashier_name: last.try_get("actor_name").map_err(|e| e.to_string())?,
    };
    for row in &rows {
        let get = |name: &str| row.try_get::<i64, _>(name).map_err(|e| e.to_string());
        totals.paid = totals.paid.checked_add(get("paid")?).ok_or("OVERFLOW")?;
        totals.cash = totals.cash.checked_add(get("cash")?).ok_or("OVERFLOW")?;
        totals.card = totals.card.checked_add(get("card")?).ok_or("OVERFLOW")?;
        totals.meal_card = totals
            .meal_card
            .checked_add(get("meal")?)
            .ok_or("OVERFLOW")?;
        totals.credit = totals
            .credit
            .checked_add(get("credit")?)
            .ok_or("OVERFLOW")?;
    }
    Ok(totals)
}

fn payment_lines(totals: &PaymentTotals) -> Vec<PaymentLine> {
    let channels = [
        ("NAKIT", totals.cash),
        ("KART", totals.card),
        ("YEMEK_KARTI", totals.meal_card),
        ("VERESIYE", totals.credit),
    ];
    let known: i64 = channels.iter().map(|(_, cents)| cents).sum();
    let mut lines: Vec<PaymentLine> = channels
        .into_iter()
        .filter(|(_, cents)| *cents > 0)
        .map(|(method, amount_cents)| PaymentLine {
            method: method.to_string(),
            amount_cents,
        })
        .collect();
    // Kanal kırılımı toplamla uyuşmuyorsa fark gizlenmez, ayrı satırda görünür.
    if totals.paid > known {
        lines.push(PaymentLine {
            method: "DIGER".to_string(),
            amount_cents: totals.paid - known,
        });
    }
    lines
}

async fn load_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<DocumentLine>, String> {
    let rows = sqlx::query(
        "SELECT COALESCE(p.name, oi.product_id) AS name, oi.quantity, oi.tax_rate_bp, \
                oi.subtotal_cents, oi.tax_amount_cents, oi.total_cents \
         FROM order_items oi \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id \
         WHERE oi.tenant_id = ? AND oi.order_id = ? AND lower(oi.status) <> 'cancelled' \
         ORDER BY oi.id",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            let get = |name: &str| row.try_get::<i64, _>(name).map_err(|e| e.to_string());
            Ok(DocumentLine {
                name: row.try_get("name").map_err(|e| e.to_string())?,
                quantity: get("quantity")?,
                net_cents: get("subtotal_cents")?,
                tax_cents: get("tax_amount_cents")?,
                gross_cents: get("total_cents")?,
                tax_rate_bp: get("tax_rate_bp")?,
            })
        })
        .collect()
}

/// Adisyonu belge modeline çevirir. Kalem toplamı `orders.total_cents` ile
/// tutmuyorsa belge üretilmez: tutarsız belge sağlayıcıda reddedilir ve ETTN yanar.
pub async fn load_document(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    supplier: Supplier,
    ids: (&str, &str, &str),
) -> Result<AdisyonDocument, String> {
    let (ettn, session_ettn, document_number) = ids;
    let order = sqlx::query(
        "SELECT o.status, o.total_cents, o.created_at, COALESCE(t.name, o.table_id) AS table_name \
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id \
         WHERE o.tenant_id = ? AND o.id = ?",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: adisyon bulunamadı".to_string())?;
    let status: String = order.try_get("status").map_err(|e| e.to_string())?;
    if status != "PAID" {
        return Err("CONFLICT: yalnız kapanmış (ödenmiş) adisyondan belge üretilir".to_string());
    }
    let order_total: i64 = order.try_get("total_cents").map_err(|e| e.to_string())?;
    let opened: String = order.try_get("created_at").map_err(|e| e.to_string())?;
    let lines = load_lines(conn, tenant_id, order_id).await?;
    let line_total = lines
        .iter()
        .try_fold(0_i64, |acc, l| acc.checked_add(l.gross_cents))
        .ok_or("OVERFLOW: kalem toplamı taştı")?;
    if line_total != order_total {
        return Err(format!(
            "CONFLICT: kalem toplamı ({line_total}) adisyon toplamıyla ({order_total}) tutmuyor"
        ));
    }
    let totals = load_payments(conn, tenant_id, order_id).await?;
    Ok(AdisyonDocument {
        ettn: ettn.to_string(),
        session_ettn: session_ettn.to_string(),
        document_number: document_number.to_string(),
        opened_at: parse_time(&opened)?,
        closed_at: parse_time(&totals.closed_at)?,
        table_name: order.try_get("table_name").map_err(|e| e.to_string())?,
        cashier_name: totals.cashier_name.clone(),
        supplier,
        lines,
        payments: payment_lines(&totals),
    })
}
