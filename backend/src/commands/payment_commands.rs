//! Ödeme komutları (tahsilat, parçalı ödeme, tenant çözümleme)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CartItemDto {
    pub id: String,
    pub product: serde_json::Value,
    pub quantity: i64,
    #[serde(rename = "unitPrice", alias = "unit_price", alias = "priceCents", alias = "price_cents", default)]
    pub unit_price: i64,
    #[serde(rename = "taxRate", alias = "tax_rate", default)]
    pub tax_rate: Option<i64>,
    #[serde(default)]
    pub subtotal: Option<i64>,
    #[serde(rename = "taxAmount", alias = "tax_amount", default)]
    pub tax_amount: Option<i64>,
    #[serde(default)]
    pub total: Option<i64>,
    pub modifiers: Option<serde_json::Value>,
    pub note: Option<String>,
    pub discount: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SplitPaymentDto {
    pub id: Option<String>,
    pub method: String,
    pub amount: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PaymentPayloadDto {
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub timestamp: String,
    pub method: String,
    #[serde(rename = "amountTendered")]
    pub amount_tendered: i64,
    #[serde(rename = "totalAmount")]
    pub total_amount: i64,
    #[serde(rename = "changeAmount")]
    pub change_amount: Option<i64>,
    pub items: Vec<CartItemDto>,
    pub splits: Option<Vec<SplitPaymentDto>>,
    pub notes: Option<String>,
    #[serde(rename = "customerRef")]
    pub customer_ref: Option<String>,
    #[serde(rename = "cashierId")]
    pub cashier_id: Option<String>,
    #[serde(rename = "terminalId")]
    pub terminal_id: Option<String>,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: Option<String>,
    #[serde(rename = "globalDiscount", default)]
    pub global_discount: Option<serde_json::Value>,
    /// Anlık PIN onayından gelen tek kullanımlık jeton. Sunucu hesabında
    /// indirim varsa **zorunludur**; indirim yoksa yok sayılır.
    #[serde(rename = "approvalToken", default)]
    pub approval_token: Option<String>,
/// İndirim/ikram işleminde onaylayan kişinin kimliği (rapor için).
    #[serde(rename = "actorId", default)]
    pub actor_id: Option<String>,
    /// Veresiye (`method = "VERESIYE"`) seçildiğinde borcun açılacağı müşteri
    /// cari kartı.
    ///
    /// Neden gerekli: `debts.directory_id` `NOT NULL` ve `directories(id)`'ye
    /// yabancı anahtarla bağlı. Veresiye tutarının kime yazılacağı masadan
    /// anlaşılamaz; çağıran bilerek seçer. Gönderilmezse komut hata döner,
    /// tahsilat kaydı oluşmaz.
    #[serde(rename = "debtDirectoryId", alias = "debt_directory_id", default)]
    pub debt_directory_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PaymentResultDto {
    pub success: bool,
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    #[serde(rename = "fiscalReceiptNo")]
    pub fiscal_receipt_no: Option<String>,
    pub timestamp: String,
    pub message: String,
    #[serde(rename = "cogsTotal")]
    pub cogs_total: Option<i64>,
}

/// Ödemenin ait olduğu tenant'ı veritabanından çözer.
///
/// Ödeme payload'ı tenant taşımaz; sahiplik siparişin ya da masanın satırında
/// durur. Denetim kaydı bu değerle yazılır; ayrıca `check_idempotency` ve
/// satış olayı da aynı tenant'ı kullanır.
async fn resolve_payment_tenant(
    conn: &mut sqlx::SqliteConnection,
    payload: &PaymentPayloadDto,
) -> String {
    if let Some(order_id) = payload.order_id.as_deref() {
        if let Ok(Some(tenant)) = sqlx::query_scalar::<_, String>(
            "SELECT tenant_id FROM orders WHERE id = ?",
        )
        .bind(order_id)
        .fetch_optional(&mut *conn)
        .await
        {
            return tenant;
        }
    }
    if let Some(table_id) = payload.customer_ref.as_deref() {
        if let Ok(Some(tenant)) = sqlx::query_scalar::<_, String>(
            "SELECT tenant_id FROM tables WHERE id = ?",
        )
        .bind(table_id)
        .fetch_optional(&mut *conn)
        .await
        {
            return tenant;
        }
    }
    "DEFAULT_TENANT".to_string()
}

#[tauri::command]
pub async fn process_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    // SPEC §34 "Ödeme Alma": işletme sahibi ve kasiyer. Garsonun yetkisi koşulludur
    // (⚠️ Yetki) ve kişi bazlı ödeme izni henüz uygulanmadığı için burada açılmaz.
    // Bu komut önceden hiç rol parametresi almadığı için yetkisiz her çağıran ödeme
    // kapatabiliyordu.
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Cashier])?;

    // Kilit sırası her yerde aynıdır: önce payment_mutex, sonra audit_mutex.
    // Ters sırada bir komut iki kilidi birden tutarken başka bir komut ters sırayı
    // beklerse kilitlenme (deadlock) oluşur.
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await;

    let (total_cogs_cents, now_iso) = crate::services::payment_service::PaymentService::process_transaction(
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
            payload.order_id.as_deref().unwrap_or(&payload.transaction_id),
            payload.total_amount,
            payload.notes.as_deref(),
        )
        .await?;

        let ctx = crate::services::audit_service::AuditContext::new(
            tenant_id.clone(),
            payload.actor_id.clone().unwrap_or_else(|| "SYSTEM".to_string()),
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
        // Faz 8: masa boşaltılıyorsa açık rezervasyon kaydı da kapatılır.
        // Yazma tenant filtresizdi; başka bir işletmenin masası bu yolla
        // boşaltılabiliyordu (AGENTS.md §3.3 ihlali).
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

    let fiscal_receipt_no = format!("FISC-WAL-{}", payload.transaction_id.chars().take(6).collect::<String>());

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

#[tauri::command]
pub async fn process_split_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    // Parçalı ödeme de tahsilattır: process_payment ile aynı SPEC satırı.
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Cashier])?;

    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
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
    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await;

    // 1. Etki eşitsizliği (Idempotency) kontrolü
    if crate::repositories::payment_repository::PaymentRepository::check_idempotency(&mut tx, &payload.transaction_id, &tenant_id).await? {
        return Err(format!(
            "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
            payload.transaction_id
        ));
    }

    // 2. K2: parçalı ödeme de aynı indirim yüzeyidir; onaysız indirim geçmez.
    // Sunucu hesabı tek doğruluk kaynağıdır, istemcinin bildirdiği indirim değil.
    let server_truth = crate::repositories::payment_repository::PaymentRepository::calculate_server_truth(
        &mut tx,
        &tenant_id,
        &payload.items,
        payload.global_discount.as_ref(),
    )
    .await?;

    let consumed_approval = crate::services::payment_approval::consume_discount_approval(
        &mut tx,
        &audit_lock,
        &tenant_id,
        actor_id,
        &actor_role,
        &payload.transaction_id,
        &server_truth,
        payload.approval_token.as_deref(),
    )
    .await?;

    // 3. Parçalı ödeme satış olayını ekle
    crate::repositories::payment_repository::PaymentRepository::insert_sale_event(&mut tx, &payload, &tenant_id).await?;

    // 3. Siparişin veritabanındaki gerçek toplamını ve şimdiye kadarki tahsilatları hesapla
    let mut order_total_cents = payload.total_amount;
    let mut order_table_id: Option<String> = None;
    let mut paid_so_far: i64 = 0;

    if let Some(order_id) = &payload.order_id {
        let order_row = sqlx::query("SELECT total_cents, table_id FROM orders WHERE id = ?")
            .bind(order_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(r) = order_row {
            order_total_cents = r.try_get::<i64, _>("total_cents").unwrap_or(payload.total_amount);
            order_table_id = r.try_get::<String, _>("table_id").ok();
        }

        let paid_row = sqlx::query(
            "SELECT COALESCE(SUM(CAST(json_extract(payload, '$.amountTendered') AS INTEGER)), 0) as total_paid \
             FROM events \
             WHERE aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED' \
             AND json_extract(payload, '$.orderId') = ?"
        )
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        paid_so_far = paid_row.try_get("total_paid").unwrap_or(0);
    }

    // Yetkili kalan bakiye (orijinal sipariş toplamından ödenenlerin düşülmesi)
    let remaining_balance = order_total_cents - paid_so_far;

    let mut total_cogs_cents: i64 = 0;
    let effective_table_id = payload.customer_ref.as_deref().or(order_table_id.as_deref());

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
            // Faz 8: tam tahsilatta masa boşalıyorsa açık rezervasyon kaydı da
            // kapanır; yazmalar tenant filtresizdi.
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
        total_cogs_cents = crate::services::inventory_service::InventoryService::execute_fifo_deduction(
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

    // Denetim defteri kaydını ekle.
    //
    // Payload alan adları `get_daily_summary` ve `get_shift_summary` tarafından
    // JSON olarak okunuyor; yeniden adlandırılmaz.
    let ledger_payload = serde_json::json!({
        "transactionId": payload.transaction_id,
        "method": payload.method,
        "totalAmount": payload.amount_tendered,
        "cogsTotalCents": total_cogs_cents,
        "itemsCount": payload.items.len(),
        "discountCents": server_truth.discount_cents,
        // Onay kimliği ödeme kaydıyla birlikte okunabilsin diye taşınır;
        // "onay verildi" ve "onay kullanıldı" ayrı kayıtlar hâlâ audit'te durur.
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
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &audit_ctx).await?;

    // WAL işlemini onayla
    tx.commit().await.map_err(|e| e.to_string())?;

    let fiscal_receipt_no = format!("FISC-SPLIT-{}", payload.transaction_id.chars().take(6).collect::<String>());

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
