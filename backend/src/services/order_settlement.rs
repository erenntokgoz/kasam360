//! Açık adisyonun tahsilatı: tam, tutara göre, kaleme göre ve adede göre.
//!
//! Neden tek yol: tam ve parçalı ödeme ayrı kodlardayken parçalı yol fazla
//! tahsilatı reddetmiyor, ödenmiş kalemi sessizce kırpıyor, veresiye borcu açmıyor
//! ve stok olarak yalnız son ödemenin kalemlerini düşüyordu. Tutar, kalem ve kalan
//! bakiye istemciden değil adisyon satırlarından okunur; istemci yalnız ne
//! ödemek istediğini söyler.

use crate::commands::{CartItemDto, PaymentPayloadDto};
use crate::repositories::payment_repository::{PaymentRepository, ServerTruth};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::ledger_service::{record_veresiye_settlement, VeresiyeSettlement};
use crate::services::payment_service::PaymentService;
use sqlx::{Row, SqliteConnection};

pub struct Settlement {
    pub total_cogs_cents: i64,
    pub now_iso: String,
    pub remaining_cents: i64,
    pub order_closed: bool,
    pub veresiye: Option<VeresiyeSettlement>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBalance {
    pub total_cents: i64,
    pub paid_cents: i64,
    pub remaining_cents: i64,
}

struct OrderLine {
    id: String,
    quantity: i64,
    paid_quantity: i64,
    total_cents: i64,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Adetin payı toplamdan kümülatif türetilir: 100 kuruşluk üç adetlik satır
/// tek tek ödense de kuruş kaybolmaz veya fazla alınmaz.
fn unit_share(line: &OrderLine, quantity: i64) -> i64 {
    let upto = |count: i64| line.total_cents * count / line.quantity;
    upto(line.paid_quantity + quantity) - upto(line.paid_quantity)
}

/// Adisyona bugüne kadar yapılan tahsilat.
///
/// `totalAmount` uygulanan tutardır. `amountTendered` kullanılamaz: nakitte
/// müşterinin verdiği para para üstünü de içerir.
async fn paid_cents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.totalAmount') AS INTEGER)), 0)
         FROM events
         WHERE tenant_id = ? AND aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED'
           AND json_extract(payload, '$.orderId') = ?",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)
}

pub async fn order_balance(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<OrderBalance, String> {
    let total: Option<i64> =
        sqlx::query_scalar("SELECT total_cents FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(order_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    let total_cents = total.ok_or_else(|| format!("NOT_FOUND: adisyon bulunamadı: {order_id}"))?;
    let paid_cents = paid_cents(conn, tenant_id, order_id).await?;
    Ok(OrderBalance {
        total_cents,
        paid_cents,
        remaining_cents: total_cents - paid_cents,
    })
}

async fn order_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<OrderLine>, String> {
    let rows = sqlx::query(
        "SELECT id, quantity, COALESCE(paid_quantity, 0) AS paid_quantity, total_cents
         FROM order_items
         WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'",
    )
    .bind(order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    rows.iter()
        .map(|row| {
            Ok(OrderLine {
                id: row.try_get("id").map_err(text_error)?,
                quantity: row.try_get("quantity").map_err(text_error)?,
                paid_quantity: row.try_get("paid_quantity").map_err(text_error)?,
                total_cents: row.try_get("total_cents").map_err(text_error)?,
            })
        })
        .collect()
}

/// Seçilen kalemlerin değerini adisyondan hesaplar ve tahsilat iznini yazar.
///
/// Aynı adet iki kez ödenemez: üst sınır kırpılmaz, işlem reddedilir. Kırpılsaydı
/// ikinci kasa kaleme para alır ama kalem ödenmiş görünürdü.
async fn claim_items(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    lines: &[OrderLine],
    items: &[CartItemDto],
) -> Result<i64, String> {
    let mut value = 0;
    for item in items {
        let line = lines
            .iter()
            .find(|line| line.id == item.id)
            .ok_or_else(|| format!("NOT_FOUND: kalem bu adisyonda değil: {}", item.id))?;
        if item.quantity <= 0 {
            return Err("VALIDATION: kalem adedi sıfırdan büyük olmalıdır.".to_string());
        }
        if line.paid_quantity + item.quantity > line.quantity {
            return Err(format!(
                "ITEM_ALREADY_PAID: kalemin {} adedi zaten ödendi.",
                line.paid_quantity
            ));
        }
        value += unit_share(line, item.quantity);
        sqlx::query(
            "UPDATE order_items SET paid_quantity = COALESCE(paid_quantity, 0) + ?
             WHERE id = ? AND tenant_id = ?",
        )
        .bind(item.quantity)
        .bind(&item.id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    Ok(value)
}

/// İstemcinin bildirdiği indirim tutarı. Kalan bakiyeyi aşamaz.
fn discount_cents(payload: &PaymentPayloadDto, remaining: i64) -> i64 {
    payload
        .global_discount
        .as_ref()
        .and_then(|discount| discount.get("value"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0)
        .clamp(0, remaining)
}

/// Yöntemi kanala ayırır. Bilinmeyen yöntem karta sayılmaz: kasa farkı buradan doğar.
fn channel_amounts(method: &str, amount: i64) -> Result<[i64; 4], String> {
    match method.to_uppercase().as_str() {
        "CASH" | "NAKIT" => Ok([amount, 0, 0, 0]),
        "CARD" | "KREDI_KARTI" | "CREDIT_CARD" => Ok([0, amount, 0, 0]),
        "MEAL_CARD" | "YEMEK_KARTI" => Ok([0, 0, amount, 0]),
        "VERESIYE" => Ok([0, 0, 0, amount]),
        other => Err(format!("INVALID_METHOD: bilinmeyen ödeme yöntemi: {other}")),
    }
}

/// Adisyon kapanışı: masa boşalır, satırlar ödenir, maliyet deftere geçer.
///
/// Stok mutfağa gönderimde düşmüştür; burada yalnız kalemlerin kayıtlı maliyeti
/// toplanır, böylece parçalı ödeme stoğu ikinci kez düşüremez (AGENTS.md §7.2).
async fn close_order(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    table_id: &str,
    now_iso: &str,
) -> Result<crate::services::inventory_service::FifoResult, String> {
    sqlx::query(
        "UPDATE orders SET status = 'PAID', updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE order_items SET paid_quantity = quantity
         WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'",
    )
    .bind(order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    let _ = crate::services::reservation_service::close_open_for_table(
        &mut *conn, tenant_id, table_id, "TAHSILAT", "TAHSILAT",
    )
    .await?;
    sqlx::query(
        "UPDATE tables SET status = 'AVAILABLE', current_total = 0, opened_at = NULL,
                waiter_id = NULL
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(table_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    crate::services::order_stock::settle_order_lines(conn, tenant_id, order_id, now_iso).await
}

pub async fn settle_order_payment(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    audit_lock: &AuditLock<'_>,
    payload: &PaymentPayloadDto,
    tenant_id: &str,
    actor_role: &str,
) -> Result<Settlement, String> {
    let now_iso = chrono::Utc::now().to_rfc3339();
    let order_id = payload
        .order_id
        .as_deref()
        .ok_or_else(|| "VALIDATION: adisyon kimliği zorunludur.".to_string())?;
    let actor_id = payload
        .actor_id
        .as_deref()
        .or(payload.cashier_id.as_deref())
        .ok_or_else(|| "UNAUTHORIZED: actor_id is required".to_string())?;
    if PaymentRepository::check_idempotency(tx, &payload.transaction_id, tenant_id).await? {
        return Err(format!(
            "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
            payload.transaction_id
        ));
    }

    let order = sqlx::query("SELECT table_id, status FROM orders WHERE id = ? AND tenant_id = ?")
        .bind(order_id)
        .bind(tenant_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(text_error)?
        .ok_or_else(|| format!("NOT_FOUND: adisyon bulunamadı: {order_id}"))?;
    let status: String = order.try_get("status").map_err(text_error)?;
    if status != "OPEN" && status != "IN_PROGRESS" {
        return Err(format!("ORDER_CLOSED: adisyon durumu {status}."));
    }
    let table_id: String = order.try_get("table_id").map_err(text_error)?;

    let balance = order_balance(tx, tenant_id, order_id).await?;
    let amount = payload.total_amount;
    let discount = discount_cents(payload, balance.remaining_cents);
    if amount < 0 || (amount == 0 && discount == 0) {
        return Err("INVALID_AMOUNT: tahsilat tutarı sıfırdan büyük olmalıdır.".to_string());
    }
    if amount + discount > balance.remaining_cents {
        return Err(format!(
            "OVERPAYMENT: kalan bakiye {} kuruş; {} kuruş tahsil edilemez.",
            balance.remaining_cents,
            amount + discount
        ));
    }
    // İndirim kalanı kapatmalıdır: parçalı akışta sonraki ödemelerin hangi
    // tutardan süreceği belirsizleşmesin.
    if discount > 0 && amount + discount != balance.remaining_cents {
        return Err("VALIDATION: indirim yalnız kalan hesabı kapatan tahsilatta uygulanır.".into());
    }
    let tendered_change = payload.amount_tendered - amount;
    if tendered_change < 0 {
        return Err("VALIDATION: verilen tutar tahsilattan az olamaz.".to_string());
    }

    let lines = order_lines(tx, tenant_id, order_id).await?;
    let selected = claim_items(tx, tenant_id, &lines, &payload.items).await?;
    if !payload.items.is_empty() && (selected - amount - discount).abs() > 1 {
        return Err(format!(
            "TOTAL_MISMATCH: seçilen kalemler {selected} kuruş, tahsilat {} kuruş.",
            amount + discount
        ));
    }

    let truth = ServerTruth {
        subtotal_cents: 0,
        tax_cents: 0,
        discount_cents: discount,
        gross_cents: amount + discount,
        total_cents: amount,
    };
    let approval = PaymentService::consume_approvals(
        tx,
        audit_lock,
        tenant_id,
        actor_id,
        actor_role,
        &payload.transaction_id,
        &truth,
        payload.approval_token.as_deref(),
    )
    .await?;
    PaymentRepository::insert_sale_event(tx, payload, tenant_id).await?;

    let remaining_cents = balance.remaining_cents - amount - discount;
    let order_closed = remaining_cents == 0;
    let fifo = if order_closed {
        Some(close_order(tx, tenant_id, order_id, &table_id, &now_iso).await?)
    } else {
        sqlx::query("UPDATE tables SET current_total = ? WHERE id = ? AND tenant_id = ?")
            .bind(remaining_cents)
            .bind(&table_id)
            .bind(tenant_id)
            .execute(&mut **tx)
            .await
            .map_err(text_error)?;
        None
    };

    let [cash, card, meal_card, veresiye_cents] = channel_amounts(&payload.method, amount)?;
    let veresiye = if veresiye_cents > 0 {
        let directory_id = payload
            .debt_directory_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Veresiye tahsilat için müşteri cari kartı seçilmelidir (debtDirectoryId)."
                    .to_string()
            })?;
        Some(
            record_veresiye_settlement(
                tx,
                tenant_id,
                directory_id,
                order_id,
                veresiye_cents,
                payload.notes.as_deref(),
            )
            .await?,
        )
    } else {
        None
    };

    let total_cogs_cents = fifo.map_or(0, |result| result.total_cogs_cents);
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::ODEME,
        "payment:settled_fifo",
        payload.transaction_id.clone(),
        serde_json::json!({
            "transactionId": payload.transaction_id,
            "orderId": order_id,
            "method": payload.method,
            "totalAmount": amount,
            "cashAmountCents": cash,
            "cardAmountCents": card,
            "mealCardAmountCents": meal_card,
            "veresiyeAmountCents": veresiye_cents,
            "changeCents": tendered_change,
            "cogsTotalCents": total_cogs_cents,
            "cogsUntrackedDeficit": fifo.map(|result| result.untracked_deficit),
            "itemsCount": payload.items.len(),
            "remainingCents": remaining_cents,
            "orderClosed": order_closed,
            "discountCents": discount,
            "discountApproval": approval.as_ref().map(|used| serde_json::json!({
                "operation": used.operation,
                "approverId": used.approver_id,
                "approverRole": used.approver_role,
                "amountCents": used.amount_cents,
            })),
            "debtId": veresiye.as_ref().map(|settlement| settlement.debt_id.clone()),
        }),
        now_iso.clone(),
    )?;
    AuditService::append(tx, audit_lock, &ctx).await?;

    Ok(Settlement {
        total_cogs_cents,
        now_iso,
        remaining_cents,
        order_closed,
        veresiye,
    })
}

#[cfg(test)]
#[path = "order_settlement_tests.rs"]
mod tests;
