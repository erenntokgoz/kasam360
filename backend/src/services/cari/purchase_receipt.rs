//! Mal kabulü: stok partisi ve tedarikçi cari hareketi tek işlemde doğar.
//!
//! Neden birlikte: stok girip borç sonraya kalınca belge gelmeyen alım cari
//! bakiyede hiç görünmez, kâr raporu maliyeti bilir ama borç listesi bilmez.
//! İkisi aynı transaction'da yazılır; biri reddedilirse hiçbiri kalmaz.
//!
//! Neden tek kez: işlem kimliği işlem günlüğünde tekildir, sipariş de yalnız
//! `TASI` durumundayken alınır. Çift tıklama ya da zaman aşımı sonrası tekrar ikinci
//! parti veya ikinci borç açamaz.
//!
//! Vadeli alımda borç açık kalır. Peşin alımda aynı borç aynı anda ödenir: ekstrede
//! alış ve ödeme ayrı satır görünür, kart bakiyesi değişmez, ödeme kanalı kaybolmaz.

use super::ops::validate_iso_date;
use super::payment::{apply_payment, RecordPaymentInput};
use super::supplier_document::resolve_card;
use super::ApplyError;
use crate::services::inventory360::quantity_cost::line_cost_cents;
use crate::services::stock_trail::SOURCE_PURCHASE;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

/// Vadeli alım: borç açık kalır.
pub const SETTLEMENT_TERM: &str = "TERM";
const UPFRONT_METHODS: [&str; 3] = ["CASH", "CREDIT_CARD", "BANK_TRANSFER"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveLine {
    pub item_id: String,
    pub batch_id: String,
    pub movement_id: String,
    /// Adetle alınan üründe bu partinin bir adedinden çıkan kullanılabilir gram.
    pub usable_grams_per_unit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivePurchaseInput {
    pub purchase_order_id: String,
    /// `TERM` (vadeli) ya da peşin ödeme kanalı: `CASH`, `CREDIT_CARD`, `BANK_TRANSFER`.
    pub settlement: String,
    pub due_date: Option<String>,
    pub document_no: Option<String>,
    pub lines: Vec<ReceiveLine>,
    pub document_id: String,
    pub debt_id: String,
    pub new_directory_id: String,
    pub payment_id: String,
    pub cash_movement_id: Option<String>,
    pub shift_id: Option<String>,
    pub actor_id: String,
    pub created_at: String,
}

fn rejected(message: impl Into<String>) -> ApplyError {
    ApplyError::Rejected(message.into())
}

fn internal(message: String) -> ApplyError {
    ApplyError::Internal(message)
}

fn validate_settlement(input: &ReceivePurchaseInput) -> Result<(), ApplyError> {
    if input.settlement == SETTLEMENT_TERM {
        return validate_iso_date(input.due_date.as_deref());
    }
    if !UPFRONT_METHODS.contains(&input.settlement.as_str()) {
        return Err(rejected(
            "VALIDATION: ödeme şekli vadeli ya da peşin kanal olmalıdır",
        ));
    }
    // Peşin alımın vadesi yoktur; vade gönderilmesi ekranın yanlış seçim yaptığını gösterir.
    if input.due_date.is_some() {
        return Err(rejected("VALIDATION: peşin alımda vade tarihi girilmez"));
    }
    Ok(())
}

/// Sipariş kalemlerini partiye çevirir; dönen değer kabul tutarıdır.
async fn receive_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &ReceivePurchaseInput,
    supplier_id: &str,
) -> Result<i64, ApplyError> {
    let items = sqlx::query(
        "SELECT poi.id, poi.product_id, poi.quantity, poi.received_quantity, poi.unit_cost_cents,
                p.stock_unit
           FROM purchase_order_items poi
           JOIN products p ON p.id = poi.product_id AND p.tenant_id = poi.tenant_id
          WHERE poi.tenant_id = ? AND poi.purchase_order_id = ?
          ORDER BY poi.id ASC",
    )
    .bind(tenant_id)
    .bind(&input.purchase_order_id)
    .fetch_all(&mut *conn)
    .await?;
    if items.is_empty() {
        return Err(rejected("VALIDATION: siparişin kalemi yok"));
    }
    if items.len() != input.lines.len() {
        return Err(rejected("CONFLICT: kabul satırları siparişle eşleşmiyor"));
    }

    let mut total = 0i64;
    for item in &items {
        let item_id: String = item.try_get("id")?;
        let line = input
            .lines
            .iter()
            .find(|line| line.item_id == item_id)
            .ok_or_else(|| rejected("CONFLICT: kabul satırları siparişle eşleşmiyor"))?;
        let product_id: String = item.try_get("product_id")?;
        let stock_unit: String = item.try_get("stock_unit")?;
        if stock_unit == "belirsiz" {
            return Err(rejected(
                "STOCK: mal kabulden önce ürünün stok birimi belirlenmeli",
            ));
        }
        if let Some(grams) = line.usable_grams_per_unit {
            if stock_unit != "adet" {
                return Err(rejected(
                    "VALIDATION: kullanılabilir gram yalnız adetle alınan üründe girilir",
                ));
            }
            if !(grams.is_finite() && grams > 0.0) {
                return Err(rejected(
                    "VALIDATION: kullanılabilir gram sıfırdan büyük olmalı",
                ));
            }
        }
        let quantity: f64 = item.try_get("quantity")?;
        let already: f64 = item.try_get("received_quantity")?;
        let unit_cost: i64 = item.try_get("unit_cost_cents")?;
        let incoming = quantity - already;
        if incoming <= f64::EPSILON {
            continue;
        }

        sqlx::query(
            "INSERT INTO inventory_batches
                 (id, tenant_id, product_id, received_at, received_by, initial_quantity,
                  remaining_quantity, unit_cost_cents, usable_grams_per_unit, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&line.batch_id)
        .bind(tenant_id)
        .bind(&product_id)
        .bind(&input.created_at)
        .bind(&input.actor_id)
        .bind(incoming)
        .bind(incoming)
        .bind(unit_cost)
        .bind(line.usable_grams_per_unit)
        .bind(&input.created_at)
        .execute(&mut *conn)
        .await?;
        let suffix = line
            .batch_id
            .strip_prefix("bat_")
            .ok_or_else(|| rejected("VALIDATION: parti kimliği geçersiz"))?;
        sqlx::query(
            "INSERT INTO supplier_products
                 (id, tenant_id, supplier_id, product_id, unit_cost_cents, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (tenant_id, supplier_id, product_id) DO NOTHING",
        )
        .bind(format!("spp_{suffix}"))
        .bind(tenant_id)
        .bind(supplier_id)
        .bind(&product_id)
        .bind(unit_cost)
        .bind(&input.created_at)
        .bind(&input.created_at)
        .execute(&mut *conn)
        .await?;
        // Kimlik ve zaman işlemden gelir: diğer cihaz aynı hareketi aynı satırla yazar.
        sqlx::query(
            "INSERT INTO stock_movements
                 (id, tenant_id, inventory_item_id, product_id, movement_type, quantity,
                  actor_id, reason, source_type, source_id, created_at)
             VALUES (?, ?, NULL, ?, 'IN', ?, ?, 'Mal kabulü', ?, ?, ?)",
        )
        .bind(&line.movement_id)
        .bind(tenant_id)
        .bind(&product_id)
        .bind(incoming)
        .bind(&input.actor_id)
        .bind(SOURCE_PURCHASE)
        .bind(&input.purchase_order_id)
        .bind(&input.created_at)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE purchase_order_items SET received_quantity = quantity
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(&item_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await?;
        total = total
            .checked_add(line_cost_cents(unit_cost, incoming).map_err(internal)?)
            .ok_or_else(|| internal("OVERFLOW: kabul toplamı taştı".to_string()))?;
    }
    Ok(total)
}

pub(super) async fn apply_receipt(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &ReceivePurchaseInput,
) -> Result<Value, ApplyError> {
    validate_settlement(input)?;
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
    if status != "TASI" {
        return Err(rejected(format!(
            "CONFLICT: sipariş {status} durumunda, yalnız bekleyen sipariş teslim alınır"
        )));
    }
    let supplier_id: String = order.try_get("supplier_id")?;
    let order_number: String = order.try_get("order_number")?;

    let total = receive_lines(conn, tenant_id, input, &supplier_id).await?;
    sqlx::query(
        "UPDATE purchase_orders SET status = 'ALINDI', received_at = ?
          WHERE id = ? AND tenant_id = ? AND status = 'TASI'",
    )
    .bind(&input.created_at)
    .bind(&input.purchase_order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await?;

    // Bedelsiz kabulde (numune, ikram) borç doğmaz; sıfır tutarlı borç ekstreyi kirletirdi.
    if total == 0 {
        return Ok(json!({
            "purchaseOrderId": input.purchase_order_id,
            "receivedTotalCents": 0,
            "debtId": null,
            "settlement": input.settlement,
        }));
    }

    let directory_id = resolve_card(
        conn,
        tenant_id,
        &supplier_id,
        &input.new_directory_id,
        &input.created_at,
    )
    .await?;
    let document_no = input
        .document_no
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(order_number.as_str())
        .to_string();
    let duplicate: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM supplier_documents
          WHERE tenant_id = ? AND directory_id = ? AND document_no = ?",
    )
    .bind(tenant_id)
    .bind(&directory_id)
    .bind(&document_no)
    .fetch_optional(&mut *conn)
    .await?;
    if duplicate.is_some() {
        return Err(rejected(
            "CONFLICT: bu tedarikçide aynı belge numarası zaten var",
        ));
    }

    let is_upfront = input.settlement != SETTLEMENT_TERM;
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, due_date, status, is_cash, description,
                            created_at)
         VALUES (?, ?, ?, 'TAKEN', ?, ?, ?, 'PENDING', ?, ?, ?)",
    )
    .bind(&input.debt_id)
    .bind(tenant_id)
    .bind(&directory_id)
    .bind(total)
    .bind(total)
    .bind(&input.due_date)
    .bind(i64::from(is_upfront))
    .bind(format!("Mal alımı · Sipariş {order_number}"))
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO supplier_documents (id, tenant_id, purchase_order_id, directory_id, debt_id,
                                         document_no, document_total_cents, received_total_cents,
                                         difference_reason, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(&input.document_id)
    .bind(tenant_id)
    .bind(&input.purchase_order_id)
    .bind(&directory_id)
    .bind(&input.debt_id)
    .bind(&document_no)
    .bind(total)
    .bind(total)
    .bind(&input.actor_id)
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;

    let payment = if is_upfront {
        Some(
            apply_payment(
                conn,
                tenant_id,
                &RecordPaymentInput {
                    payment_id: input.payment_id.clone(),
                    debt_id: input.debt_id.clone(),
                    amount_cents: total,
                    payment_method: input.settlement.clone(),
                    actor_id: input.actor_id.clone(),
                    notes: Some("Peşin alım".to_string()),
                    expected_version: 0,
                    cash_movement_id: input.cash_movement_id.clone(),
                    shift_id: input.shift_id.clone(),
                    created_at: input.created_at.clone(),
                },
                true,
            )
            .await?,
        )
    } else {
        None
    };

    Ok(json!({
        "purchaseOrderId": input.purchase_order_id,
        "receivedTotalCents": total,
        "directoryId": directory_id,
        "debtId": input.debt_id,
        "documentNo": document_no,
        "settlement": input.settlement,
        "dueDate": input.due_date,
        "payment": payment,
    }))
}

#[cfg(test)]
#[path = "purchase_receipt_tests.rs"]
mod tests;
