//! Tahsilat iadesinin sınırları: ne kadar, hangi kanaldan, hangi durumda.
//!
//! Neden ayrı servis: tutar ve kanal istemciden alınırsa aynı fiş tekrar tekrar
//! iade edilebilir ve nakit iade kasadan düşmez. İkisi de kayıtlı tahsilattan
//! okunur; komut yalnız yetki, onay ve yazımla ilgilenir.

use sqlx::{Row, SqliteConnection};

#[derive(Debug, PartialEq, Eq)]
pub struct RefundPlan {
    pub order_id: Option<String>,
    /// `refunds.method` değeri. Kasa mutabakatı nakit iadeyi buradan ayırır.
    pub method: &'static str,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Tahsilat yöntemini iade kanalına çevirir. Yemek kartında kasadan para çıkmaz.
///
/// Veresiyede kasadan para çıkmaz, müşterinin cari borcu azalır. Bilinmeyen yöntem
/// reddedilir; sessizce nakit dışı sayılsaydı kasa farkı oluşurdu.
fn refund_method(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_uppercase().as_str() {
        "CASH" | "NAKIT" => Ok("CASH"),
        "CARD" | "KREDI_KARTI" | "CREDIT_CARD" => Ok("CREDIT_CARD"),
        "MEAL_CARD" | "YEMEK_KARTI" => Ok("COMPENSATION"),
        "VERESIYE" => Ok("VERESIYE"),
        other => Err(format!(
            "INVALID_METHOD: bu tahsilat yöntemi iade edilemez: {other}"
        )),
    }
}

/// Tahsilata bugüne kadar yapılan iade toplamı.
pub async fn refunded_cents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM refunds
         WHERE tenant_id = ? AND original_transaction_id = ?",
    )
    .bind(tenant_id)
    .bind(transaction_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)
}

/// İadeyi kayıtlı tahsilata karşı doğrular.
pub async fn plan_refund(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
    amount_cents: i64,
) -> Result<RefundPlan, String> {
    let row = sqlx::query(
        "SELECT payload FROM events
         WHERE tenant_id = ? AND aggregate_id = ?
           AND aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED'
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(transaction_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| format!("NOT_FOUND: tahsilat bulunamadı: {transaction_id}"))?;
    let raw: String = row.try_get("payload").map_err(text_error)?;
    let sale: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let paid = sale
        .get("totalAmount")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "tahsilat tutarı (totalAmount) kayıtta eksik".to_string())?;
    let method = refund_method(sale.get("method").and_then(|m| m.as_str()).unwrap_or(""))?;
    let order_id = sale
        .get("orderId")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string);

    let remaining = paid - refunded_cents(conn, tenant_id, transaction_id).await?;
    if amount_cents > remaining {
        return Err(format!(
            "REFUND_EXCEEDS_PAYMENT: iade edilebilir tutar {remaining} kuruş; {amount_cents} kuruş iade edilemez."
        ));
    }

    if let Some(order) = order_id.as_deref() {
        let status: Option<String> =
            sqlx::query_scalar("SELECT status FROM orders WHERE id = ? AND tenant_id = ?")
                .bind(order)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(text_error)?;
        if status.as_deref() == Some("COMPENSATED") {
            return Err("INVALID_STATE: adisyonun tamamı zaten iade edildi.".to_string());
        }
    }

    // Vardiya pencereye göre hesaplandığı için açık vardiya yoksa nakit iade hiçbir
    // kasadan düşmez ve sayımda açıklanamayan fark olarak kalır.
    if method == "CASH" {
        let open: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM shifts WHERE tenant_id = ? AND status = 'OPEN'",
        )
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(text_error)?;
        if open == 0 {
            return Err("SHIFT_REQUIRED: nakit iade için açık vardiya gerekir.".to_string());
        }
    }

    Ok(RefundPlan { order_id, method })
}

/// Son tahsilatın kanalı ve vardiyası: geri ödeme aynı kanaldan yapılır.
async fn collected_channel(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    debt_id: &str,
) -> Result<String, String> {
    sqlx::query_scalar(
        "SELECT payment_method FROM debt_payments
         WHERE tenant_id = ? AND debt_id = ? AND amount_cents > 0
         ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(debt_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| "NOT_FOUND: veresiye tahsilatı bulunamadı.".to_string())
}

/// Tahsil edilmiş kısım müşteriye geri ödenir. Cari ekstresi ve kasa birlikte düzelir:
/// negatif hareket ekstrede borç satırı olarak görünür, nakitse kasadan çıkar.
async fn repay_collected(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    debt_id: &str,
    amount_cents: i64,
    actor_id: &str,
) -> Result<(), String> {
    let method = collected_channel(conn, tenant_id, debt_id).await?;
    let shift_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN'
         ORDER BY opened_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    if method == "CASH" {
        let shift = shift_id
            .as_deref()
            .ok_or_else(|| "SHIFT_REQUIRED: nakit iade için açık vardiya gerekir.".to_string())?;
        sqlx::query(
            "INSERT INTO cash_movements
                 (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
             VALUES (?, ?, ?, 'OUT', ?, 'Veresiye iadesi', ?, datetime('now'))",
        )
        .bind(crate::id_generator::generate_id("csh"))
        .bind(tenant_id)
        .bind(shift)
        .bind(amount_cents)
        .bind(actor_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    sqlx::query(
        "INSERT INTO debt_payments
             (id, tenant_id, debt_id, amount_cents, payment_method, shift_id, actor_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Veresiye iadesi', datetime('now'))",
    )
    .bind(crate::id_generator::generate_id("pay"))
    .bind(tenant_id)
    .bind(debt_id)
    .bind(-amount_cents)
    .bind(&method)
    .bind(&shift_id)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Veresiye iadesi: önce açık borç azalır, kalanı tahsil edilmiş kısımdan geri ödenir.
pub async fn reduce_veresiye_debt(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: Option<&str>,
    amount_cents: i64,
    actor_id: &str,
) -> Result<(), String> {
    let order_id =
        order_id.ok_or_else(|| "NOT_FOUND: veresiye satışın adisyonu bulunamadı.".to_string())?;
    let row = sqlx::query(
        "SELECT id, remaining_amount_cents, total_amount_cents FROM debts
         WHERE tenant_id = ? AND order_id = ? AND type = 'GIVEN' LIMIT 1",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| "NOT_FOUND: veresiye borcu bulunamadı.".to_string())?;
    let debt_id: String = row.try_get("id").map_err(text_error)?;
    let remaining: i64 = row.try_get("remaining_amount_cents").map_err(text_error)?;
    let total: i64 = row.try_get("total_amount_cents").map_err(text_error)?;
    if amount_cents > total {
        return Err(format!(
            "REFUND_EXCEEDS_DEBT: borç toplamı {total} kuruş; {amount_cents} kuruş iade edilemez."
        ));
    }
    let open_part = amount_cents.min(remaining);
    let collected_part = amount_cents - open_part;
    if collected_part > 0 {
        repay_collected(conn, tenant_id, &debt_id, collected_part, actor_id).await?;
    }
    let left = remaining - open_part;
    let status = if left == 0 {
        "PAID"
    } else if total > remaining {
        "PARTIAL"
    } else {
        "PENDING"
    };
    sqlx::query(
        "UPDATE debts SET total_amount_cents = ?, remaining_amount_cents = ?, status = ?
         WHERE tenant_id = ? AND id = ?",
    )
    .bind(total - amount_cents)
    .bind(left)
    .bind(status)
    .bind(tenant_id)
    .bind(&debt_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

#[cfg(test)]
#[path = "refund_service_tests.rs"]
mod tests;
