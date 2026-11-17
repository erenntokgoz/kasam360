//! Yazar kasa fiş günlüğü: kesilen fişler ve kalıcı uyarılar.
//!
//! Neden günlük: ÖKC açıkken tahsilat fişsiz tamamlanmaz; başarısız deneme
//! kaybolmamalı, kasiyere kalıcı uyarı olarak gösterilmelidir. Aynı `transaction_id`
//! için tek satır tutulur; başarılı yeniden deneme uyarıyı kapatır. Kart veya
//! kimlik bilgisi tutulmaz.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use super::types::{FiscalReceipt, OkcError};
use crate::id_generator::generate_id;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRow {
    pub id: String,
    pub transaction_id: String,
    pub order_id: Option<String>,
    pub status: String,
    pub unique_id: Option<String>,
    pub receipt_no: Option<i64>,
    pub z_no: Option<i64>,
    pub eku_no: Option<i64>,
    pub total_cents: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub attempts: i64,
    pub updated_at: String,
}

const COLUMNS: &str = "id, transaction_id, order_id, status, unique_id, receipt_no, z_no, eku_no,
    total_cents, error_code, error_message, attempts, CAST(updated_at AS TEXT) AS updated_at";

fn map_row(row: &sqlx::sqlite::SqliteRow) -> Result<ReceiptRow, String> {
    let text = |e: sqlx::Error| e.to_string();
    Ok(ReceiptRow {
        id: row.try_get("id").map_err(text)?,
        transaction_id: row.try_get("transaction_id").map_err(text)?,
        order_id: row.try_get("order_id").map_err(text)?,
        status: row.try_get("status").map_err(text)?,
        unique_id: row.try_get("unique_id").map_err(text)?,
        receipt_no: row.try_get("receipt_no").map_err(text)?,
        z_no: row.try_get("z_no").map_err(text)?,
        eku_no: row.try_get("eku_no").map_err(text)?,
        total_cents: row.try_get("total_cents").map_err(text)?,
        error_code: row.try_get("error_code").map_err(text)?,
        error_message: row.try_get("error_message").map_err(text)?,
        attempts: row.try_get("attempts").map_err(text)?,
        updated_at: row.try_get("updated_at").map_err(text)?,
    })
}

pub async fn find(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
) -> Result<Option<ReceiptRow>, String> {
    let row = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM okc_receipts WHERE tenant_id = ? AND transaction_id = ?"
    ))
    .bind(tenant_id)
    .bind(transaction_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    row.as_ref().map(map_row).transpose()
}

/// Fiş kesildi. Aynı adisyonun önceki başarısız denemeleri kapatılır: uyarı
/// yalnız hâlâ fişsiz kalan tahsilat için görünür.
pub async fn record_issued(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
    order_id: Option<&str>,
    receipt: &FiscalReceipt,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO okc_receipts
            (id, tenant_id, transaction_id, order_id, status, unique_id, receipt_no, z_no, eku_no, total_cents)
         VALUES (?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, transaction_id) DO UPDATE SET
            status = 'ISSUED',
            unique_id = excluded.unique_id,
            receipt_no = excluded.receipt_no,
            z_no = excluded.z_no,
            eku_no = excluded.eku_no,
            total_cents = excluded.total_cents,
            error_code = NULL,
            error_message = NULL,
            updated_at = datetime('now')",
    )
    .bind(generate_id("okr"))
    .bind(tenant_id)
    .bind(transaction_id)
    .bind(order_id)
    .bind(&receipt.unique_id)
    .bind(i64::from(receipt.receipt_no))
    .bind(i64::from(receipt.z_no))
    .bind(i64::from(receipt.eku_no))
    .bind(receipt.total_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(order_id) = order_id {
        sqlx::query(
            "UPDATE okc_receipts SET status = 'SUPERSEDED', updated_at = datetime('now')
             WHERE tenant_id = ? AND order_id = ? AND status = 'FAILED' AND transaction_id != ?",
        )
        .bind(tenant_id)
        .bind(order_id)
        .bind(transaction_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Başarısız deneme. Kesilmiş fişin satırı asla başarısızlığa çevrilmez.
pub async fn record_failure(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
    order_id: Option<&str>,
    total_cents: i64,
    error: &OkcError,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO okc_receipts
            (id, tenant_id, transaction_id, order_id, status, total_cents, error_code, error_message)
         VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?)
         ON CONFLICT(tenant_id, transaction_id) DO UPDATE SET
            status = 'FAILED',
            total_cents = excluded.total_cents,
            error_code = excluded.error_code,
            error_message = excluded.error_message,
            attempts = okc_receipts.attempts + 1,
            updated_at = datetime('now')
         WHERE okc_receipts.status != 'ISSUED'",
    )
    .bind(generate_id("okr"))
    .bind(tenant_id)
    .bind(transaction_id)
    .bind(order_id)
    .bind(total_cents)
    .bind(error.code())
    .bind(error.to_string())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hâlâ fişsiz kalan tahsilat denemeleri: kalıcı uyarı listesi.
pub async fn list_open_failures(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<ReceiptRow>, String> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM okc_receipts
         WHERE tenant_id = ? AND status = 'FAILED'
         ORDER BY updated_at DESC LIMIT 200"
    ))
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(map_row).collect()
}
