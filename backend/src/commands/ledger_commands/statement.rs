//! Cari ekstre ve tediye makbuzu komutları.
//!
//! Neden imza: iki komut da içeriği veritabanından türetir. İstemciden gelen
//! tutar veya metin kabul edilmez; aksi hâlde uydurma mali belge basılabilirdi.

use crate::db::DbPool;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant};
use crate::services::ledger_statement::{
    directory_statement, format_cents, method_label, payment_receipt_lines, StatementLine,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StatementLineDto {
    pub id: String,
    pub kind: String,
    #[serde(rename = "signedAmountCents")]
    pub signed_amount_cents: i64,
    /// İşaretli tutarın hazır biçimi (`1.234,56 TL`).
    #[serde(rename = "signedAmountLabel")]
    pub signed_amount_label: String,
    pub description: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "balanceAfterCents")]
    pub balance_after_cents: i64,
    #[serde(rename = "balanceAfterLabel")]
    pub balance_after_label: String,
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    #[serde(rename = "documentNo")]
    pub document_no: Option<String>,
    #[serde(rename = "purchaseOrderId")]
    pub purchase_order_id: Option<String>,
    #[serde(rename = "orderNumber")]
    pub order_number: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DirectoryStatementDto {
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: String,
    #[serde(rename = "directoryType")]
    pub directory_type: String,
    #[serde(rename = "openingBalanceCents")]
    pub opening_balance_cents: i64,
    #[serde(rename = "openingBalanceLabel")]
    pub opening_balance_label: String,
    #[serde(rename = "closingBalanceCents")]
    pub closing_balance_cents: i64,
    #[serde(rename = "closingBalanceLabel")]
    pub closing_balance_label: String,
    #[serde(rename = "totalDebitCents")]
    pub total_debit_cents: i64,
    #[serde(rename = "totalCreditCents")]
    pub total_credit_cents: i64,
    pub lines: Vec<StatementLineDto>,
    #[serde(rename = "fromDate")]
    pub from_date: String,
    #[serde(rename = "toDate")]
    pub to_date: String,
}

impl From<StatementLine> for StatementLineDto {
    fn from(value: StatementLine) -> Self {
        Self {
            signed_amount_label: format_cents(value.signed_amount_cents),
            balance_after_label: format_cents(value.balance_after_cents),
            id: value.id,
            kind: value.kind,
            signed_amount_cents: value.signed_amount_cents,
            description: value.description,
            created_at: value.created_at,
            balance_after_cents: value.balance_after_cents,
            debt_id: value.debt_id,
            due_date: value.due_date,
            order_id: value.order_id,
            document_no: value.document_no,
            purchase_order_id: value.purchase_order_id,
            order_number: value.order_number,
        }
    }
}

/// Bir cari kartın hesap ekstresi.
#[tauri::command]
pub async fn get_directory_statement(
    directory_id: String,
    from: String,
    to: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<DirectoryStatementDto, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;

    let s = directory_statement(&pool, &tid, &directory_id, &from, &to).await?;

    Ok(DirectoryStatementDto {
        opening_balance_label: format_cents(s.opening_balance_cents),
        closing_balance_label: format_cents(s.closing_balance_cents),
        directory_id: s.directory_id,
        directory_name: s.directory_name,
        directory_type: s.directory_type,
        opening_balance_cents: s.opening_balance_cents,
        closing_balance_cents: s.closing_balance_cents,
        total_debit_cents: s.total_debit_cents,
        total_credit_cents: s.total_credit_cents,
        lines: s.lines.into_iter().map(StatementLineDto::from).collect(),
        from_date: s.from_date,
        to_date: s.to_date,
    })
}

#[derive(Debug, Serialize, Clone)]
pub struct StatementOrderLineDto {
    pub name: String,
    pub quantity: i64,
    #[serde(rename = "totalCents")]
    pub total_cents: i64,
}

/// Ekstredeki adisyon bağlantısı: borcun hangi satıştan doğduğunu gösterir.
#[tauri::command]
pub async fn get_statement_order(
    order_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<StatementOrderLineDto>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT COALESCE(p.name, i.product_id), i.quantity, i.total_cents
         FROM order_items i
         LEFT JOIN products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
         WHERE i.tenant_id = ? AND i.order_id = ? AND i.status != 'CANCELLED'",
    )
    .bind(&tid)
    .bind(&order_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(name, quantity, total_cents)| StatementOrderLineDto {
            name,
            quantity,
            total_cents,
        })
        .collect())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PaymentReceiptDto {
    #[serde(rename = "paymentId")]
    pub payment_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    pub lines: Vec<String>,
    /// Termal çıktı düzeni doğrulaması için makbuz satırı sayısı.
    #[serde(rename = "lineCount")]
    pub line_count: i64,
}

/// 80mm termal tediye makbuzunu üretir.
///
/// Neden `payment_id` ile sınırlı: tediye makbuzu bir ödeme kaydının varlığını
/// kanıtlar. Serbest metin kabul edilirse kasada olmayan bir tahsilat makbuzu
/// basılabilirdi.
#[tauri::command]
pub async fn print_payment_receipt(
    payment_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<PaymentReceiptDto, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT dp.id, dp.amount_cents, dp.payment_method, dp.created_at,
                d.id AS debt_id, d.status, dir.name AS directory_name,
                -- Eski makbuz yeniden basılınca o anki kalan görünmelidir.
                d.total_amount_cents - (
                    SELECT SUM(prior.amount_cents) FROM debt_payments prior
                    WHERE prior.debt_id = dp.debt_id AND prior.tenant_id = dp.tenant_id
                      AND (prior.created_at, prior.id) <= (dp.created_at, dp.id)
                ) AS remaining_after_cents
         FROM debt_payments dp
         JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
         JOIN directories dir ON dir.id = d.directory_id AND dir.tenant_id = d.tenant_id
         WHERE dp.id = ? AND dp.tenant_id = ?",
    )
    .bind(&payment_id)
    .bind(&tid)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("Tahsilat okunamadı: {}", e))?
    .ok_or_else(|| "NOT_FOUND: bu işletmeye ait tahsilat bulunamadı".to_string())?;

    let debt_id: String = row.try_get("debt_id").map_err(|e| e.to_string())?;
    let directory_name: String = row.try_get("directory_name").map_err(|e| e.to_string())?;
    let amount_cents: i64 = row.try_get("amount_cents").map_err(|e| e.to_string())?;
    let remaining_after_cents: i64 = row
        .try_get("remaining_after_cents")
        .map_err(|e| e.to_string())?;
    let method: String = row.try_get("payment_method").map_err(|e| e.to_string())?;
    let status: String = row.try_get("status").map_err(|e| e.to_string())?;
    let issued_at: String = row.try_get("created_at").map_err(|e| e.to_string())?;

    let status_label = match status.as_str() {
        "PAID" => "ÖDENDİ",
        "PARTIAL" => "KISMEN ÖDENDİ",
        "PENDING" => "BEKLEMEDE",
        "OVERDUE" => "VADESİ GEÇTİ",
        _ => status.as_str(),
    };

    let lines = payment_receipt_lines(
        &directory_name,
        &debt_id,
        &payment_id,
        amount_cents,
        remaining_after_cents,
        method_label(&method),
        status_label,
        &issued_at,
    );

    Ok(PaymentReceiptDto {
        line_count: lines.len() as i64,
        payment_id: payment_id.clone(),
        directory_name,
        issued_at,
        lines: lines.into_iter().map(|l| l.text).collect(),
    })
}
