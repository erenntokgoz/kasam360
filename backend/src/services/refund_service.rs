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
/// Veresiye reddedilir: müşteri para ödemediği için geri verilecek para yoktur,
/// düzeltme cari hesapta yapılır. Bilinmeyen yöntem de reddedilir; sessizce
/// nakit dışı sayılsaydı kasa farkı oluşurdu.
fn refund_method(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_uppercase().as_str() {
        "CASH" | "NAKIT" => Ok("CASH"),
        "CARD" | "KREDI_KARTI" | "CREDIT_CARD" => Ok("CREDIT_CARD"),
        "MEAL_CARD" | "YEMEK_KARTI" => Ok("COMPENSATION"),
        "VERESIYE" => Err(
            "REFUND_VERESIYE: veresiye satış iade edilemez; düzeltme cari hesaptan yapılır."
                .to_string(),
        ),
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

#[cfg(test)]
#[path = "refund_service_tests.rs"]
mod tests;
