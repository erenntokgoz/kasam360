//! Tedarikçi belgesi onayı.
//!
//! Mal kabulü stoğu artırır ama borç doğurmaz; belge sonradan gelebilir. Borç,
//! belge kontrol edilip onaylandığında doğar. Belge ile kabul tutarı farkı
//! sessizce düzeltilmez: gerekçesiz onay reddedilir, gerekçe belgeye mühürlenir.

use super::ops::validate_iso_date;
use super::ApplyError;
use crate::services::inventory360::quantity_cost::line_cost_cents;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveDocumentInput {
    pub document_id: String,
    pub debt_id: String,
    /// Tedarikçinin henüz cari kartı yoksa açılacak kartın kimliği.
    pub new_directory_id: String,
    pub purchase_order_id: String,
    pub document_no: String,
    pub document_total_cents: i64,
    pub due_date: Option<String>,
    pub difference_reason: Option<String>,
    pub actor_id: String,
    pub created_at: String,
}

/// Mal kabulü yapılmış, belgesi henüz onaylanmamış sipariş.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitingDocument {
    pub purchase_order_id: String,
    pub order_number: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub directory_id: Option<String>,
    pub received_at: Option<String>,
    pub received_total_cents: i64,
    pub payment_term_days: i64,
}

fn rejected(message: impl Into<String>) -> ApplyError {
    ApplyError::Rejected(message.into())
}

fn internal(message: String) -> ApplyError {
    ApplyError::Internal(message)
}

/// Kabul edilen miktarların sipariş anında dondurulmuş fiyatla toplamı.
async fn received_total_cents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<i64, ApplyError> {
    let lines = sqlx::query(
        "SELECT unit_cost_cents, received_quantity FROM purchase_order_items
         WHERE tenant_id = ? AND purchase_order_id = ? AND received_quantity > 0",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut total = 0i64;
    for line in lines {
        let unit_cost: i64 = line.try_get("unit_cost_cents")?;
        let quantity: f64 = line.try_get("received_quantity")?;
        total = total
            .checked_add(line_cost_cents(unit_cost, quantity).map_err(internal)?)
            .ok_or_else(|| internal("OVERFLOW: kabul toplamı taştı".to_string()))?;
    }
    Ok(total)
}

/// Stok tedarikçisini cari karta kimlikle bağlar; kart yoksa açar.
pub(super) async fn resolve_card(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    supplier_id: &str,
    new_directory_id: &str,
    created_at: &str,
) -> Result<String, ApplyError> {
    let linked: Option<String> = sqlx::query_scalar(
        "SELECT directory_id FROM supplier_cari_links WHERE tenant_id = ? AND supplier_id = ?",
    )
    .bind(tenant_id)
    .bind(supplier_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(directory_id) = linked {
        return Ok(directory_id);
    }
    let inserted = sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, phone, email, tax_no, address,
                                  notes, created_at)
         SELECT ?, tenant_id, name, 'SUPPLIER', phone, email, tax_number, address, notes, ?
         FROM suppliers WHERE id = ? AND tenant_id = ?",
    )
    .bind(new_directory_id)
    .bind(created_at)
    .bind(supplier_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(rejected("NOT_FOUND: tedarikçi bulunamadı"));
    }
    sqlx::query(
        "INSERT INTO supplier_cari_links (tenant_id, supplier_id, directory_id) VALUES (?, ?, ?)",
    )
    .bind(tenant_id)
    .bind(supplier_id)
    .bind(new_directory_id)
    .execute(&mut *conn)
    .await?;
    Ok(new_directory_id.to_string())
}

pub(super) async fn apply_document(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &ApproveDocumentInput,
) -> Result<Value, ApplyError> {
    let document_no = input.document_no.trim();
    if document_no.is_empty() {
        return Err(rejected("VALIDATION: belge numarası zorunludur"));
    }
    if input.document_total_cents <= 0 {
        return Err(rejected("VALIDATION: belge tutarı 0'dan büyük olmalıdır"));
    }
    validate_iso_date(input.due_date.as_deref())?;

    let order = sqlx::query(
        "SELECT status, supplier_id, order_number FROM purchase_orders
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&input.purchase_order_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| rejected("NOT_FOUND: sipariş bulunamadı"))?;
    let status: String = order.try_get("status")?;
    if status != "ALINDI" {
        return Err(rejected(
            "CONFLICT: belge yalnız mal kabulü tamamlanmış sipariş için onaylanır",
        ));
    }
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM supplier_documents WHERE tenant_id = ? AND purchase_order_id = ?",
    )
    .bind(tenant_id)
    .bind(&input.purchase_order_id)
    .fetch_optional(&mut *conn)
    .await?;
    if existing.is_some() {
        return Err(rejected("CONFLICT: bu siparişin belgesi zaten onaylandı"));
    }

    let received_total = received_total_cents(conn, tenant_id, &input.purchase_order_id).await?;
    let difference = input.document_total_cents - received_total;
    let reason = input
        .difference_reason
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    if difference != 0 && reason.is_none() {
        return Err(rejected(format!(
            "DIFFERENCE: belge tutarı kabul tutarından farklı ({difference} kuruş); gerekçe zorunludur"
        )));
    }

    let supplier_id: String = order.try_get("supplier_id")?;
    let order_number: String = order.try_get("order_number")?;
    let directory_id = resolve_card(
        conn,
        tenant_id,
        &supplier_id,
        &input.new_directory_id,
        &input.created_at,
    )
    .await?;
    let duplicate: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM supplier_documents
         WHERE tenant_id = ? AND directory_id = ? AND document_no = ?",
    )
    .bind(tenant_id)
    .bind(&directory_id)
    .bind(document_no)
    .fetch_optional(&mut *conn)
    .await?;
    if duplicate.is_some() {
        return Err(rejected(
            "CONFLICT: bu tedarikçide aynı belge numarası zaten var",
        ));
    }

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, due_date, status, is_cash, description,
                            created_at)
         VALUES (?, ?, ?, 'TAKEN', ?, ?, ?, 'PENDING', 0, ?, ?)",
    )
    .bind(&input.debt_id)
    .bind(tenant_id)
    .bind(&directory_id)
    .bind(input.document_total_cents)
    .bind(input.document_total_cents)
    .bind(&input.due_date)
    .bind(format!("Belge {document_no} · Sipariş {order_number}"))
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO supplier_documents (id, tenant_id, purchase_order_id, directory_id, debt_id,
                                         document_no, document_total_cents, received_total_cents,
                                         difference_reason, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.document_id)
    .bind(tenant_id)
    .bind(&input.purchase_order_id)
    .bind(&directory_id)
    .bind(&input.debt_id)
    .bind(document_no)
    .bind(input.document_total_cents)
    .bind(received_total)
    .bind(reason)
    .bind(&input.actor_id)
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;

    Ok(json!({
        "documentId": input.document_id,
        "debtId": input.debt_id,
        "directoryId": directory_id,
        "documentNo": document_no,
        "documentTotalCents": input.document_total_cents,
        "receivedTotalCents": received_total,
        "differenceCents": difference,
        "differenceReason": reason,
    }))
}

/// "Belge bekleniyor" listesi.
pub async fn awaiting_documents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<AwaitingDocument>, String> {
    let rows = sqlx::query(
        "SELECT po.id, po.order_number, po.received_at, po.supplier_id,
                s.name AS supplier_name, s.payment_term_days, link.directory_id
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
         LEFT JOIN supplier_cari_links link
                ON link.supplier_id = po.supplier_id AND link.tenant_id = po.tenant_id
         WHERE po.tenant_id = ? AND po.status = 'ALINDI'
           AND NOT EXISTS (SELECT 1 FROM supplier_documents sd
                           WHERE sd.purchase_order_id = po.id AND sd.tenant_id = po.tenant_id)
         ORDER BY po.received_at ASC, po.id ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| format!("Belge bekleyen siparişler okunamadı: {e}"))?;

    let mut list = Vec::with_capacity(rows.len());
    for r in rows {
        let purchase_order_id: String = r.try_get("id").map_err(|e| e.to_string())?;
        let received_total_cents = received_total_cents(conn, tenant_id, &purchase_order_id)
            .await
            .map_err(String::from)?;
        list.push(AwaitingDocument {
            purchase_order_id,
            order_number: r.try_get("order_number").map_err(|e| e.to_string())?,
            supplier_id: r.try_get("supplier_id").map_err(|e| e.to_string())?,
            supplier_name: r.try_get("supplier_name").map_err(|e| e.to_string())?,
            directory_id: r.try_get("directory_id").map_err(|e| e.to_string())?,
            received_at: r.try_get("received_at").map_err(|e| e.to_string())?,
            received_total_cents,
            payment_term_days: r.try_get("payment_term_days").map_err(|e| e.to_string())?,
        });
    }
    Ok(list)
}
