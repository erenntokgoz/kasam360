//! Kurye mutabakatı: kapıda tahsil edilen nakit ve kart, kasaya kuryeden teslim alınır.
//!
//! Tahsilat kuryenin elinde olduğu sürece adisyon açık kalır ve kasada hareket yoktur.
//! Mutabakatta her sipariş mevcut tahsilat hattından (`settle_order_payment`) kendi
//! yöntemiyle kapanır; nakit ve kart payları bu yüzden vardiya kasasında doğru kanalda
//! görünür, stok ise adisyon kapanışında bir kez maliyetlenir. Kuryenin teslim ettiği
//! tutar beklenenden farklıysa fark, açıklamayla birlikte kayda geçer.

use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use super::{amount_gate, find_delivery, optional_text, text_error, DeliveryRow};
use crate::commands::PaymentPayloadDto;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::order_settlement::{order_balance, settle_order_payment};

const NOTE_MAX: usize = 500;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleInput {
    pub courier_id: String,
    pub delivery_ids: Vec<String>,
    pub received_cash_cents: i64,
    pub received_card_cents: i64,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettlementResult {
    pub settlement_id: String,
    pub order_count: i64,
    pub expected_cash_cents: i64,
    pub expected_card_cents: i64,
    pub received_cash_cents: i64,
    pub received_card_cents: i64,
    /// Teslim alınan eksi beklenen; eksik nakit negatif görünür.
    pub cash_difference_cents: i64,
    pub card_difference_cents: i64,
}

fn payment(order_id: &str, method: &str, amount_cents: i64, actor_id: &str) -> PaymentPayloadDto {
    PaymentPayloadDto {
        transaction_id: crate::id_generator::generate_id("txn"),
        order_id: Some(order_id.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        method: method.to_string(),
        amount_tendered: amount_cents,
        total_amount: amount_cents,
        change_amount: None,
        items: Vec::new(),
        splits: None,
        notes: Some("Paket servis".to_string()),
        customer_ref: None,
        cashier_id: Some(actor_id.to_string()),
        terminal_id: None,
        idempotency_key: None,
        approval_token: None,
        actor_id: Some(actor_id.to_string()),
        debt_directory_id: None,
        meal_card_provider: None,
    }
}

/// Önceden ödenmiş siparişi teslimde kapatır. Kasaya nakit ya da kart girmez, ciroya yazılır.
pub async fn settle_prepaid(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    delivery: &DeliveryRow,
) -> Result<(), String> {
    let balance = order_balance(conn, tenant_id, &delivery.order_id).await?;
    if balance.remaining_cents <= 0 {
        return Err("INVALID_AMOUNT: kapatılacak bakiye yok".to_string());
    }
    let payload = payment(
        &delivery.order_id,
        "ONLINE",
        balance.remaining_cents,
        actor_id,
    );
    settle_order_payment(conn, lock, &payload, tenant_id, actor_role).await?;
    sqlx::query("UPDATE delivery_orders SET settled_at = ? WHERE id = ? AND tenant_id = ?")
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&delivery.id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok(())
}

/// Kuryeden nakit ve kartı teslim alır; seçilen siparişleri kapatır.
pub async fn settle_courier(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: &SettleInput,
) -> Result<SettlementResult, String> {
    super::require_enabled(conn, tenant_id).await?;
    amount_gate(input.received_cash_cents, "teslim alınan nakit")?;
    amount_gate(input.received_card_cents, "teslim alınan kart")?;
    let note = optional_text(&input.note, "açıklama", NOTE_MAX)?;
    let courier_id = input.courier_id.trim();
    let mut ids: Vec<&str> = input.delivery_ids.iter().map(|id| id.trim()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Err("INVALID_ARGUMENT: mutabakat için en az bir sipariş seçilmeli".to_string());
    }

    let mut deliveries = Vec::with_capacity(ids.len());
    for id in &ids {
        let delivery = find_delivery(conn, tenant_id, id).await?;
        if delivery.courier_id.as_deref() != Some(courier_id) {
            return Err("FORBIDDEN: sipariş bu kuryeye ait değil".to_string());
        }
        if delivery.status != "DELIVERED" || delivery.settled_at.is_some() {
            return Err("INVALID_TRANSITION: sipariş mutabakata uygun değil".to_string());
        }
        if !matches!(delivery.payment_method.as_str(), "CASH" | "CARD") {
            return Err("INVALID_ARGUMENT: ön ödemeli sipariş kuryeden tahsil edilmez".to_string());
        }
        deliveries.push(delivery);
    }

    let mut expected_cash: i64 = 0;
    let mut expected_card: i64 = 0;
    let mut amounts = Vec::with_capacity(deliveries.len());
    for delivery in &deliveries {
        let remaining = order_balance(conn, tenant_id, &delivery.order_id)
            .await?
            .remaining_cents;
        let sum = if delivery.payment_method == "CASH" {
            &mut expected_cash
        } else {
            &mut expected_card
        };
        *sum = sum
            .checked_add(remaining)
            .ok_or_else(|| "OVERFLOW: mutabakat toplamı taştı".to_string())?;
        amounts.push(remaining);
    }
    let cash_difference = input.received_cash_cents - expected_cash;
    let card_difference = input.received_card_cents - expected_card;
    if (cash_difference != 0 || card_difference != 0) && note.is_empty() {
        return Err(
            "VALIDATION: teslim alınan tutar beklenenden farklı, açıklama zorunlu".to_string(),
        );
    }

    let settlement_id = crate::id_generator::generate_id("crs");
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO courier_settlements (id, tenant_id, courier_id, order_count, expected_cash_cents,
                expected_card_cents, received_cash_cents, received_card_cents, note, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&settlement_id)
    .bind(tenant_id)
    .bind(courier_id)
    .bind(deliveries.len() as i64)
    .bind(expected_cash)
    .bind(expected_card)
    .bind(input.received_cash_cents)
    .bind(input.received_card_cents)
    .bind(&note)
    .bind(actor_id)
    .bind(&now)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    for (delivery, amount) in deliveries.iter().zip(&amounts) {
        let payload = payment(
            &delivery.order_id,
            &delivery.payment_method,
            *amount,
            actor_id,
        );
        settle_order_payment(conn, lock, &payload, tenant_id, actor_role).await?;
        sqlx::query(
            "UPDATE delivery_orders SET settlement_id = ?, settled_at = ?
             WHERE id = ? AND tenant_id = ? AND settled_at IS NULL",
        )
        .bind(&settlement_id)
        .bind(&now)
        .bind(&delivery.id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }

    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::FINANS,
        "delivery:courier_settled",
        settlement_id.clone(),
        serde_json::json!({
            "settlementId": settlement_id,
            "courierId": courier_id,
            "orderCount": deliveries.len(),
            "expectedCashCents": expected_cash,
            "expectedCardCents": expected_card,
            "receivedCashCents": input.received_cash_cents,
            "receivedCardCents": input.received_card_cents,
            "cashDifferenceCents": cash_difference,
            "cardDifferenceCents": card_difference,
            "note": note,
        }),
        now,
    )?;
    AuditService::append(conn, lock, &ctx).await?;

    Ok(SettlementResult {
        settlement_id,
        order_count: deliveries.len() as i64,
        expected_cash_cents: expected_cash,
        expected_card_cents: expected_card,
        received_cash_cents: input.received_cash_cents,
        received_card_cents: input.received_card_cents,
        cash_difference_cents: cash_difference,
        card_difference_cents: card_difference,
    })
}
