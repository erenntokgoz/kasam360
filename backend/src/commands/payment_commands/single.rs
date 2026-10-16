//! Tekil tahsilat komutu (process_payment).
//!
//! Neden ayrı dosya: payment_commands.rs dosyasının 500 satır tavanını
//! aşmasını önlemek için tekil ödeme akışı ayrıldı.

use super::types::{resolve_payment_tenant, PaymentPayloadDto, PaymentResultDto};
use crate::db::DbPool;

#[tauri::command]
pub async fn process_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    // İşletme sahibi ve kasiyer ödeme alabilir.
    crate::rbac::require_any(
        &actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Cashier],
    )?;

    // Kilit sırası her yerde aynıdır: önce payment_mutex, sonra audit_mutex.
    // Ters sırada bir komut iki kilidi birden tutarken başka bir komut ters sırayı
    // beklerse kilitlenme (deadlock) oluşur.
    let _lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await?;

    let (total_cogs_cents, now_iso) =
        crate::services::payment_service::PaymentService::process_transaction(
            &payload,
            &mut tx,
            &audit_lock,
            &tenant_id,
            &actor_role,
        )
        .await?;

    // Veresiye: tahsilat yok, kasada hareket yok; yalnız cari borç açılır.
    //
    // Neden burada ve `process_split_payment`'ten önce: `process_transaction`
    // satış olayını yazar ve stok düşümünü kilitler; veresiye de bir adisyon
    // kapanışıdır, aynı yol geçer. Tek fark borcun açılmasıdır.
    let veresiye = if payload.method.eq_ignore_ascii_case("VERESIYE") {
        let directory_id = payload
            .debt_directory_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Veresiye tahsilat için müşteri cari kartı seçilmelidir (debtDirectoryId)."
                    .to_string()
            })?;

        let settlement = crate::services::ledger_service::record_veresiye_settlement(
            &mut tx,
            &tenant_id,
            directory_id,
            payload
                .order_id
                .as_deref()
                .unwrap_or(&payload.transaction_id),
            payload.total_amount,
            payload.notes.as_deref(),
        )
        .await?;

        let ctx = crate::services::audit_service::AuditContext::new(
            tenant_id.clone(),
            payload
                .actor_id
                .clone()
                .unwrap_or_else(|| "SYSTEM".to_string()),
            actor_role.clone(),
            crate::services::audit_service::category::FINANS,
            "payment:veresiye",
            settlement.debt_id.clone(),
            serde_json::json!({
                "debtId": settlement.debt_id,
                "directoryId": directory_id,
                "directoryName": settlement.directory_name,
                "amountCents": settlement.amount_cents,
                "orderId": payload.order_id,
                // Kasa değişmediğinin denetim kanıtı: nakit hareketi yazılmadı.
                "cashMovement": false,
            }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

        Some(settlement)
    } else {
        None
    };

    // Aktif siparişi temizle ve masayı AVAILABLE olarak ayarla
    if let Some(table_id) = &payload.customer_ref {
        // Masa boşaltılıyorsa açık rezervasyon kaydı da kapatılır.
        // Yazma tenant filtresizdi; başka bir işletmenin masası bu yolla
        // boşaltılabiliyordu (AGENTS.md §2.7 ihlali).
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

        sqlx::query("UPDATE orders SET status = 'PAID' WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
            .bind(table_id.trim())
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // WAL işlemini (transaction) onayla
    tx.commit().await.map_err(|e| e.to_string())?;

    let fiscal_receipt_no = format!(
        "FISC-WAL-{}",
        payload.transaction_id.chars().take(6).collect::<String>()
    );

    let message = match veresiye.as_ref() {
        Some(s) => format!(
            "Veresiye Kapatıldı: {} ({} kuruş) cari borca işlendi. Kasa hareketi yapılmadı. Mali Fiş: {}",
            s.directory_name, s.amount_cents, fiscal_receipt_no
        ),
        None => format!(
            "Ödeme Başarıyla Tamamlandı & FIFO Stok Düşümü Kilitlendi. Mali Fiş: {}",
            fiscal_receipt_no
        ),
    };

    Ok(PaymentResultDto {
        success: true,
        transaction_id: payload.transaction_id,
        fiscal_receipt_no: Some(fiscal_receipt_no),
        timestamp: now_iso,
        message,
        cogs_total: Some(total_cogs_cents),
    })
}
