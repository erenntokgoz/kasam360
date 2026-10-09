//! Ödeme komutları (tahsilat, parçalı ödeme, tenant çözümleme)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use crate::rbac::Role;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CartItemDto {
    pub id: String,
    pub product: serde_json::Value,
    pub quantity: i64,
    #[serde(
        rename = "unitPrice",
        alias = "unit_price",
        alias = "priceCents",
        alias = "price_cents",
        default
    )]
    pub unit_price: i64,
    /// Deprecated: Faz 17'de kaldırılacak, yerine `tax_rate_bp` gelecek.
    /// Hesap backend'deneldiği için client'tan okunmaz; geriye uyumluluk için kalır.
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

/// Ödemenin ait olduğu tenant'ı veritabanından fail-closed çözer.
///
/// Ödeme payload'ı tenant taşımaz; sahiplik siparişin ya da
/// masanın satırında durur. Denetim kaydı bu değerle yazılır;
/// ayrıca `check_idempotency` ve satış olayı da aynı tenant'ı
/// kullanır.
///
/// Neden hata döner: ne sipariş ne masa kiracısını çözerse
/// varsayılan kiracıya düşmek, ödemeyi kimliği belirsiz bir
/// işletmenin defterine yazmaktır. Kiracı çözülemezse
/// tahsilat yazılmaz (fail-closed, AGENTS.md §3.3).
async fn resolve_payment_tenant(
    conn: &mut sqlx::SqliteConnection,
    payload: &PaymentPayloadDto,
) -> Result<String, String> {
    if let Some(order_id) = payload.order_id.as_deref() {
        if let Ok(Some(tenant)) =
            sqlx::query_scalar::<_, String>("SELECT tenant_id FROM orders WHERE id = ?")
                .bind(order_id)
                .fetch_optional(&mut *conn)
                .await
        {
            return Ok(tenant);
        }
    }
    if let Some(table_id) = payload.customer_ref.as_deref() {
        if let Ok(Some(tenant)) =
            sqlx::query_scalar::<_, String>("SELECT tenant_id FROM tables WHERE id = ?")
                .bind(table_id)
                .fetch_optional(&mut *conn)
                .await
        {
            return Ok(tenant);
        }
    }
    Err("UNAUTHORIZED: tenant_id is required".to_string())
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

#[tauri::command]
pub async fn process_split_payment(
    payload: PaymentPayloadDto,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<PaymentResultDto, String> {
    // Parçalı ödeme de tahsilattır: process_payment ile aynı SPEC satırı.
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

    // 2. K2: parçalı ödeme de aynı indirim yüzeyidir; onaysız indirim geçmez.
    // Sunucu hesabı tek doğruluk kaynağıdır, istemcinin bildirdiği indirim değil.
    let server_truth =
        crate::repositories::payment_repository::PaymentRepository::calculate_server_truth(
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
    crate::repositories::payment_repository::PaymentRepository::insert_sale_event(
        &mut tx, &payload, &tenant_id,
    )
    .await?;

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
            order_total_cents = r
                .try_get::<i64, _>("total_cents")
                .unwrap_or(payload.total_amount);
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

/// Compensation refund payload'ı: ters bir tahsilat kaydı oluşturur.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CompensationRefundPayloadDto {
    /// Orijinal tahsilatın transaction_id'si (txn_ prefix).
    #[serde(rename = "originalTransactionId")]
    pub original_transaction_id: String,
    /// Orijinal sipariş ID'si (opsiyonel; events tablosundan çözülebilir).
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    /// Geri iade tutarı (kuruş). AGENTS.md §3.4: 0 kontrolü zorunlu.
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    /// Onay token'ı (REFUND scope).
    #[serde(rename = "approvalToken")]
    pub approval_token: Option<String>,
}

/// Compensation refund: yapılmış bir tahsilatı tersine çevirir.
///
/// `create_compensation_void` sipariş seviyesinde, bu komut transaction
/// seviyesindedir. Orijinal `transaction_id` (`txn_*`) üzerinden events tablosunda
/// kaydı bulunur; aynı tutarın tersini yazar.
///
/// Süreç:
///   1. Actor rolü yetkili mi? (OWNER | MANAGER)
///   2. Orijinal transaction var mı ve tutarı > 0 mı? (hata yükseltilir, 0'a dönülmez)
///   3. Onay tokenı tüketilir (scope: operation=REFUND, resource=original_txn_id).
///   4. `refunds` tablosuna ters kayıt eklenir.
///   5. `events` tablosuna COMPENSATION_REVERSAL event'i eklenir.
///   6. `audit_ledger`e FINANS kategorisinde `compensation:refund` kaydı eklenir.
///
/// AGENTS.md §2: ters ID `ref_` prefix'li ULID. §3.4: hata `?` ile yükseltilir.
#[tauri::command]
pub async fn create_compensation_refund(
    payload: CompensationRefundPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    use crate::services::audit_service::category;

    let _payment_lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = tenant_id.trim().to_string();
    if tenant_id.is_empty() {
        return Err("UNAUTHORIZED: tenant_id is required".to_string());
    }

    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        Role::Owner | Role::Manager => {}
        Role::Cashier | Role::Waiter | Role::Kitchen | Role::Master => {
            return Err("UNAUTHORIZED: Bu rol compensation refund yapamaz".to_string());
        }
    }

    if payload.amount_cents <= 0 {
        return Err("INVALID_AMOUNT: Refund tutarı 0'dan büyük olmalıdır.".to_string());
    }

    // Orijinal transaction'ı doğrula (tenant filtresiz arama kesinlikle YASAK).
    let original_event = sqlx::query(
        "SELECT aggregate_id, payload FROM events \
         WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = 'SALE' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&payload.original_transaction_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if original_event.is_none() {
        return Err(format!(
            "NOT_FOUND: Transaction '{}' bu kiracı için bulunamadı.",
            payload.original_transaction_id
        ));
    }

    // Onay tokenı
    let approval_request = crate::approval_service::ApprovalRequest {
        tenant_id: tenant_id.clone(),
        operation: crate::approval_service::operation::REFUND.to_string(),
        resource_id: payload.original_transaction_id.clone(),
        actor_id: payload.actor_id.clone(),
        actor_role: actor_role.as_str().to_string(),
        amount_cents: payload.amount_cents,
        approved_percent_hint: 0,
        terminal_id: crate::id_generator::generate_terminal_id(),
    };

    let approver = crate::commands::void_commands::require_void_approval(
        &mut tx,
        &approval_request,
        payload.approval_token.as_deref(),
    )
    .await?;

    let refund_id = crate::id_generator::generate_id("ref");
    let now_iso = chrono::Utc::now().to_rfc3339();

    // a) refunds tablosu
    sqlx::query(
        "INSERT INTO refunds (id, tenant_id, original_transaction_id, original_order_id, \
            compensation_txn_id, amount_cents, reason, method, actor_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPENSATION', ?, datetime('now'))",
    )
    .bind(&refund_id)
    .bind(&tenant_id)
    .bind(&payload.original_transaction_id)
    .bind(payload.order_id.as_deref().unwrap_or(""))
    .bind(&refund_id)
    .bind(payload.amount_cents)
    .bind(&payload.reason)
    .bind(&approver.approver_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // b) events: ters talep kaydı
    let comp_event_id = crate::id_generator::generate_id("evt");
    let comp_payload = serde_json::json!({
        "originalTransactionId": payload.original_transaction_id,
        "amountCents": payload.amount_cents,
        "reason": payload.reason,
        "compensationTxnId": refund_id,
    });
    let comp_payload_json = serde_json::to_string(&comp_payload).map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
         VALUES (?, ?, ?, 'COMPENSATION', 'REFUND_REVERSAL', ?, datetime('now'))"
    )
    .bind(&comp_event_id)
    .bind(&tenant_id)
    .bind(&payload.original_transaction_id)
    .bind(&comp_payload_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // c) audit_ledger
    let audit_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        category::FINANS,
        "compensation:refund",
        payload.original_transaction_id.clone(),
        comp_payload,
        now_iso.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &audit_ctx).await?;

    let consumed_ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        approver.approver_id.clone(),
        approver.approver_role.as_str().to_string(),
        category::GUVENLIK,
        "approval:consumed",
        payload.original_transaction_id,
        serde_json::json!({
            "operation": crate::approval_service::operation::REFUND,
            "amountCents": payload.amount_cents,
            "actorId": payload.actor_id,
            "approverId": approver.approver_id,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &consumed_ctx)
        .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(true)
}
