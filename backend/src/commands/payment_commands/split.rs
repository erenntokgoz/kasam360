//! Parçalı tahsilat komutu (process_split_payment).
//!
//! Neden ayrı dosya: payment_commands.rs dosyasının 500 satır tavanını
//! aşmasını önlemek için parçalı ödeme akışı ayrıldı.

use super::types::{resolve_payment_tenant, PaymentPayloadDto, PaymentResultDto};
use crate::db::DbPool;
use sqlx::Row;

#[tauri::command]
pub async fn process_split_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    // Parçalı ödeme de tahsilattır: process_payment ile aynı yetki kuralı.
    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Cashier],
    )?;

    let _lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    // Kimlik önceliği `actorId` → `cashierId`: onay jetonunun sahibi ile denetim
    // kaydının aktörü aynı kişi olmalı.
    let actor_id = payload
        .actor_id
        .as_deref()
        .or(payload.cashier_id.as_deref())
        .unwrap_or("SYSTEM_POS")
        .to_string();
    let actor_id = actor_id.as_str();
    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await?;

    // 1. Etki eşitsizliği (Idempotency) kontrolü
    if crate::repositories::payment_repository::PaymentRepository::check_idempotency(
        &mut tx,
        &payload.transaction_id,
        &tenant_id,
    )
    .await?
    {
        return Err(format!(
            "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
            payload.transaction_id
        ));
    }

    // 2. Parçalı ödeme de aynı indirim ve tutar yüzeyidir; onaysız indirim/eşik geçmez.
    // Sunucu hesabı tek doğruluk kaynağıdır, istemcinin bildirdiği tutar/indirim değil.
    let (server_truth, consumed_approval) =
        crate::services::payment_service::PaymentService::validate_server_truth_and_approvals(
            &mut tx,
            &audit_lock,
            &tenant_id,
            actor_id,
            &actor_role,
            &payload,
        )
        .await?;

    // 3. Parçalı ödeme satış olayını ekle
    crate::repositories::payment_repository::PaymentRepository::insert_sale_event(
        &mut tx, &payload, &tenant_id,
    )
    .await?;

    // 4. Siparişin veritabanındaki gerçek toplamını ve şimdiye kadarki tahsilatları hesapla
    let mut order_total_cents = payload.total_amount;
    let mut order_table_id: Option<String> = None;
    let mut paid_so_far: i64 = 0;

    if let Some(order_id) = &payload.order_id {
        let order_row =
            sqlx::query("SELECT total_cents, table_id FROM orders WHERE id = ? AND tenant_id = ?")
                .bind(order_id)
                .bind(&tenant_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;

        let (total, table_id) = if let Some(r) = order_row {
            let total: i64 = r.try_get("total_cents").map_err(|e| e.to_string())?;
            let table_id: Option<String> = r.try_get("table_id").ok();
            (total, table_id)
        } else {
            return Err(format!(
                "NOT_FOUND: Order '{}' not found for tenant",
                order_id
            ));
        };
        order_total_cents = total;
        order_table_id = table_id;

        let paid_row = sqlx::query(
            "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.amountTendered') AS INTEGER)), 0) as total_paid \
             FROM events \
             WHERE aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED' \
             AND tenant_id = ? \
             AND json_extract(payload, '$.orderId') = ?"
        )
        .bind(&tenant_id)
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        paid_so_far = paid_row.try_get("total_paid").map_err(|e| e.to_string())?;
    }

    // Yetkili kalan bakiye (orijinal sipariş toplamından ödenenlerin düşülmesi)
    let remaining_balance = order_total_cents - paid_so_far;

    let mut total_cogs_cents: i64 = 0;
    let effective_table_id = payload
        .customer_ref
        .as_deref()
        .or(order_table_id.as_deref());

    if remaining_balance <= 0 {
        if let Some(order_id) = &payload.order_id {
            sqlx::query("UPDATE orders SET status = 'PAID', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
                .bind(order_id)
                .bind(&tenant_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        if let Some(table_id) = effective_table_id {
            let _ = crate::services::reservation_service::close_open_for_table(
                &mut tx,
                &tenant_id,
                table_id.trim(),
                &actor_role,
                "TAHSILAT",
            )
            .await?;

            sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0 WHERE id = ? AND tenant_id = ?")
                .bind(table_id.trim())
                .bind(&tenant_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;

            sqlx::query("UPDATE orders SET status = 'PAID', updated_at = datetime('now') WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
                .bind(table_id.trim())
                .bind(&tenant_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        // Çift stok düşümünü engelle: YALNIZCA sipariş tamamen kapandığında TEK SEFERDE FIFO stok düşümü yapılır!
        total_cogs_cents =
            crate::services::inventory_service::InventoryService::execute_fifo_deduction(
                &mut tx,
                &tenant_id,
                &payload.transaction_id,
                &payload.items,
                &now_iso,
            )
            .await?
            .total_cogs_cents;
    } else if let Some(table_id) = effective_table_id {
        sqlx::query("UPDATE tables SET current_total = ? WHERE id = ? AND tenant_id = ?")
            .bind(remaining_balance)
            .bind(table_id.trim())
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Parçalı ödemede ödenen kalemlerin paid_quantity değerini artır (Alman usulü izleme)
    for item in &payload.items {
        sqlx::query(
            "UPDATE order_items SET paid_quantity = MIN(quantity, COALESCE(paid_quantity, 0) + ?) WHERE id = ? AND tenant_id = ?"
        )
        .bind(item.quantity)
        .bind(&item.id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let mut cash_amount_cents: i64 = 0;
    let mut card_amount_cents: i64 = 0;
    let mut meal_card_amount_cents: i64 = 0;
    let mut veresiye_amount_cents: i64 = 0;

    match payload.method.to_uppercase().as_str() {
        "CASH" | "NAKIT" => cash_amount_cents = payload.amount_tendered,
        "CARD" | "KREDI_KARTI" | "CREDIT_CARD" => card_amount_cents = payload.amount_tendered,
        "MEAL_CARD" | "YEMEK_KARTI" | "MULTINET" | "SODEXO" | "TICKET" | "SETCARD" => {
            meal_card_amount_cents = payload.amount_tendered
        }
        "VERESIYE" => veresiye_amount_cents = payload.amount_tendered,
        _ => card_amount_cents = payload.amount_tendered,
    }

    // Denetim defteri kaydını ekle.
    let ledger_payload = serde_json::json!({
        "transactionId": payload.transaction_id,
        "method": payload.method,
        "totalAmount": payload.amount_tendered,
        "cashAmountCents": cash_amount_cents,
        "cardAmountCents": card_amount_cents,
        "mealCardAmountCents": meal_card_amount_cents,
        "veresiyeAmountCents": veresiye_amount_cents,
        "cogsTotalCents": total_cogs_cents,
        "itemsCount": payload.items.len(),
        "discountCents": server_truth.discount_cents,
        "discountApproval": match consumed_approval.as_ref() {
            Some(approval) => serde_json::json!({
                "operation": approval.operation,
                "approverId": approval.approver_id,
                "approverRole": approval.approver_role,
                "amountCents": approval.amount_cents,
            }),
            None => serde_json::Value::Null,
        },
    });
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id.to_string(),
        actor_role.clone(),
        crate::services::audit_service::category::ODEME,
        "payment:settled_fifo",
        payload.transaction_id.clone(),
        ledger_payload,
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &audit_ctx).await?;

    // WAL işlemini onayla
    tx.commit().await.map_err(|e| e.to_string())?;

    let fiscal_receipt_no = format!(
        "FISC-SPLIT-{}",
        payload.transaction_id.chars().take(6).collect::<String>()
    );

    Ok(PaymentResultDto {
        success: true,
        transaction_id: payload.transaction_id,
        fiscal_receipt_no: Some(fiscal_receipt_no.clone()),
        timestamp: now_iso,
        message: format!(
            "Parçalı Ödeme Başarıyla Tamamlandı & Fiş Üretildi. Mali Fiş: {}",
            fiscal_receipt_no
        ),
        cogs_total: Some(total_cogs_cents),
    })
}
