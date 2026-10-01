use crate::db::DbPool;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};
use uuid::Uuid;

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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TicketStatusTransitionDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "itemId")]
    pub item_id: Option<String>,
    #[serde(rename = "fromStatus")]
    pub from_status: String,
    #[serde(rename = "toStatus")]
    pub to_status: String,
    pub timestamp: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
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

/// Komutun çağıranı oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır.
///
/// Eskiden bu yollar "System" yazıyordu; fark, artık bunu bir **sabit** olarak
/// değil, çağıranın gerçekten bildirmediği bir gerçek olarak ifade ediyoruz.
fn audit_actor(actor_id: Option<String>, actor_role: Option<String>) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.unwrap_or_else(|| "System".to_string()),
    )
}

/// Denetim kaydının tenant'ını masa satırından okur; satır yoksa tek varsayılan
/// tenant'a düşer.
async fn table_tenant(
    conn: &mut sqlx::SqliteConnection,
    table_id: &str,
) -> String {
    sqlx::query_scalar::<_, String>("SELECT tenant_id FROM tables WHERE id = ?")
        .bind(table_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "DEFAULT_TENANT".to_string())
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

    // Aktif siparişi temizle ve masayı AVAILABLE olarak ayarla
    if let Some(table_id) = &payload.customer_ref {
        sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0 WHERE id = ?")
            .bind(table_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        sqlx::query("UPDATE orders SET status = 'PAID' WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
            .bind(table_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // WAL işlemini (transaction) onayla
    tx.commit().await.map_err(|e| e.to_string())?;

    let fiscal_receipt_no = format!("FISC-WAL-{}", payload.transaction_id.chars().take(6).collect::<String>());

    Ok(PaymentResultDto {
        success: true,
        transaction_id: payload.transaction_id,
        fiscal_receipt_no: Some(fiscal_receipt_no.clone()),
        timestamp: now_iso,
        message: format!(
            "Ödeme Başarıyla Tamamlandı & FIFO Stok Düşümü Kilitlendi. Mali Fiş: {}",
            fiscal_receipt_no
        ),
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
    let actor_id = payload.cashier_id.as_deref().unwrap_or("SYSTEM_POS");
    let tenant_id = resolve_payment_tenant(&mut tx, &payload).await;

    // 1. Etki eşitsizliği (Idempotency) kontrolü
    if crate::repositories::payment_repository::PaymentRepository::check_idempotency(&mut tx, &payload.transaction_id, &tenant_id).await? {
        return Err(format!(
            "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
            payload.transaction_id
        ));
    }

    // 2. Parçalı ödeme satış olayını ekle
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
            sqlx::query("UPDATE orders SET status = 'PAID', updated_at = datetime('now') WHERE id = ?")
                .bind(order_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        if let Some(table_id) = effective_table_id {
            sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0 WHERE id = ?")
                .bind(table_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;

            sqlx::query("UPDATE orders SET status = 'PAID', updated_at = datetime('now') WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
                .bind(table_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        // Çift stok düşümünü engelle: YALNIZCA sipariş tamamen kapandığında TEK SEFERDE FIFO stok düşümü yapılır!
        total_cogs_cents = crate::services::inventory_service::InventoryService::execute_fifo_deduction(
            &mut tx,
            &payload.transaction_id,
            &payload.items,
            &now_iso,
        )
        .await?;
    } else if let Some(table_id) = effective_table_id {
        sqlx::query("UPDATE tables SET current_total = ? WHERE id = ?")
            .bind(remaining_balance)
            .bind(table_id)
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

#[tauri::command]
pub async fn kds_update_ticket_status(
    payload: TicketStatusTransitionDto,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let event_id = format!("evt_kds_{}", Uuid::new_v4());
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let order_info = sqlx::query("SELECT tenant_id, table_id FROM orders WHERE id = ?")
        .bind(&payload.order_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let tenant_id = order_info.as_ref()
        .and_then(|r| r.try_get::<String, _>("tenant_id").ok())
        .unwrap_or_else(|| "DEFAULT_TENANT".to_string());

    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'KDS_TICKET', 'TICKET_STATUS_UPDATED', ?, datetime('now'))"
    )
    .bind(&event_id)
    .bind(&tenant_id)
    .bind(&payload.order_id)
    .bind(&payload_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let outbox_id = format!("outbox_{}", Uuid::new_v4());
    sqlx::query(
        "INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))"
    )
    .bind(&outbox_id)
    .bind(&tenant_id)
    .bind(&event_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Sipariş güncellenme zaman damgasını yenile
    sqlx::query("UPDATE orders SET updated_at = datetime('now') WHERE id = ?")
        .bind(&payload.order_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let to_upper = payload.to_status.to_uppercase();
    if to_upper == "PREPARING" {
        sqlx::query("UPDATE order_items SET status = 'Preparing' WHERE order_id = ? AND (status = 'Pending' OR status = 'PENDING')")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else if to_upper == "READY" {
        sqlx::query("UPDATE order_items SET status = 'Ready' WHERE order_id = ? AND UPPER(status) NOT IN ('COMPLETED', 'SERVED')")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else if to_upper == "COMPLETED" || to_upper == "SERVED" {
        sqlx::query("UPDATE order_items SET status = 'Completed' WHERE order_id = ?")
            .bind(&payload.order_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // KDS durum geçişi de bir operasyonel değişikliktir: mutfak ekranındaki her
    // ilerleme "Sipariş & Masa" kategorisine yazılır. İstemci tarafında ikinci bir
    // ledger bulunmadığından bu kayıt tek gerçek kaynaktır.
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        payload.actor_role.clone(),
        crate::services::audit_service::category::SIPARIS_MASA,
        "kds:ticket_status_advanced",
        payload.order_id.clone(),
        serde_json::json!({
            "fromStatus": payload.from_status,
            "toStatus": payload.to_status,
            "eventId": event_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct KdsOrderDto {
    pub id: String,
    #[serde(rename = "orderNumber")]
    pub order_number: String,
    #[serde(rename = "tableNumber")]
    pub table_number: Option<String>,
    pub status: String,
    pub items: Vec<serde_json::Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub priority: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn get_active_tickets(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<KdsOrderDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query("
        SELECT o.id, t.name as table_name, o.created_at, o.notes
        FROM orders o
        LEFT JOIN tables t ON o.table_id = t.id
        WHERE o.status = 'IN_PROGRESS' AND (o.tenant_id = ? OR o.tenant_id = 'DEFAULT_TENANT')
        ORDER BY o.created_at ASC
    ")
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for r in rows {
        let id: String = r.try_get("id").unwrap_or_default();

        let item_rows = sqlx::query("
            SELECT oi.id, oi.quantity, COALESCE(p.name, 'Ürün') as product_name, oi.station, oi.modifiers, oi.notes, oi.status
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        ")
        .bind(&id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        if item_rows.is_empty() {
            continue;
        }

        let mut items = Vec::new();
        let mut all_completed = true;
        let mut all_ready = true;
        let mut any_preparing = false;

        for ir in item_rows {
            let product_name: String = ir.try_get("product_name").unwrap_or_default();
            let quantity: i64 = ir.try_get("quantity").unwrap_or(0);
            let station: Option<String> = ir.try_get("station").ok();
            let resolved_station = station.unwrap_or_else(|| "Sıcak".to_string());
            let modifiers_str: Option<String> = ir.try_get("modifiers").ok();
            let notes: Option<String> = ir.try_get("notes").ok();
            let status: String = ir.try_get("status").unwrap_or_else(|_| "Pending".to_string());

            let st_upper = status.to_uppercase();
            if st_upper != "COMPLETED" && st_upper != "SERVED" && st_upper != "CANCELLED" {
                all_completed = false;
            }
            if st_upper != "READY" && st_upper != "COMPLETED" && st_upper != "SERVED" {
                all_ready = false;
            }
            if st_upper == "PREPARING" || st_upper == "IN_PROGRESS" {
                any_preparing = true;
            }

            let modifiers: Vec<String> = if let Some(m) = modifiers_str {
                serde_json::from_str(&m).unwrap_or_default()
            } else {
                Vec::new()
            };

            items.push(serde_json::json!({
                "id": ir.try_get::<String, _>("id").unwrap_or_default(),
                "orderId": id.clone(),
                "name": product_name,
                "quantity": quantity,
                "station": resolved_station.clone(),
                "stationId": resolved_station,
                "status": status,
                "modifiers": modifiers,
                "notes": notes
            }));
        }

        if all_completed {
            continue;
        }

        let final_status = if all_ready {
            "Ready".to_string()
        } else if any_preparing {
            "Preparing".to_string()
        } else {
            "Pending".to_string()
        };

        let created_at_str: String = r.try_get("created_at").unwrap_or_default();
        let priority = if let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(&created_at_str) {
            let elapsed = chrono::Utc::now().signed_duration_since(created_at.with_timezone(&chrono::Utc));
            if elapsed.num_minutes() >= 15 {
                "RUSH".to_string()
            } else {
                "NORMAL".to_string()
            }
        } else {
            "NORMAL".to_string()
        };

        res.push(KdsOrderDto {
            id: id.clone(),
            order_number: format!("ORD-{}", id.chars().take(4).collect::<String>().to_uppercase()),
            table_number: r.try_get("table_name").ok(),
            status: final_status,
            items,
            created_at: created_at_str,
            priority,
            notes: r.try_get("notes").ok(),
        });
    }

    Ok(res)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FloorPlanData {
    pub id: String,
    pub name: String,
    pub status: String,
    #[serde(rename = "openedAt")]
    pub opened_at: Option<String>,
    #[serde(rename = "waiterId")]
    pub waiter_id: Option<String>,
    /// Running total for the table in integer cents. 0 means no active order.
    #[serde(rename = "currentTotal")]
    pub current_total: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosCategoryDto {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosProductDto {
    pub id: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    #[serde(rename = "priceCents", alias = "price_cents")]
    pub price_cents: i32,
    #[serde(rename = "taxRate", alias = "tax_rate")]
    pub tax_rate: f64,
    pub category: String,
    pub description: Option<String>,
    #[serde(rename = "inStock", alias = "in_stock")]
    pub in_stock: bool,
    #[serde(rename = "stockQuantity", alias = "stock_quantity")]
    pub stock_quantity: Option<i32>,
    pub color: Option<String>,
    #[serde(rename = "imageUrl", alias = "image_url")]
    pub image_url: Option<String>,
}

#[tauri::command]
pub async fn get_floor_plan(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<FloorPlanData>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, status, opened_at, waiter_id, current_total FROM tables WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        res.push(FloorPlanData {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            status: row.try_get("status").unwrap_or_else(|_| "AVAILABLE".to_string()),
            opened_at: row.try_get("opened_at").ok(),
            waiter_id: row.try_get("waiter_id").ok(),
            current_total: row.try_get::<i64, _>("current_total").unwrap_or(0),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn move_table(
    from_id: String,
    to_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET status='AVAILABLE' WHERE id=?")
        .bind(&from_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET status='OCCUPIED' WHERE id=?")
        .bind(&to_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE orders SET table_id=? WHERE table_id=? AND status IN ('OPEN', 'IN_PROGRESS')")
        .bind(&to_id)
        .bind(&from_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "fromId": from_id,
        "toId": to_id
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        table_tenant(&mut tx, &to_id).await,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:move",
        to_id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn reserve_table(
    table_id: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET status='RESERVED' WHERE id=? AND tenant_id=?")
        .bind(&table_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:reserved",
        table_id.clone(),
        serde_json::json!({ "tableId": table_id }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn pos_get_categories(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<PosCategoryDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, icon FROM categories WHERE tenant_id = ? ORDER BY display_order ASC")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        res.push(PosCategoryDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            icon: row.try_get("icon").ok(),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn pos_get_products(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<PosProductDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Akıllı Sipariş Motoru: En sık sipariş edilen ürünler en başta yer alır
    let rows = sqlx::query(
        "SELECT p.id, p.sku, p.barcode, p.name, p.price_cents, p.tax_rate, p.category_id, p.description, p.is_active, p.stock_quantity, p.color, p.image_url,
                COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) as frequency
         FROM products p
         WHERE p.is_active = 1 AND p.tenant_id = ?
         ORDER BY frequency DESC, p.name ASC"
    )
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        let price_cents: i32 = row.try_get("price_cents").unwrap_or(0);
        res.push(PosProductDto {
            id: row.try_get("id").unwrap_or_default(),
            sku: row.try_get("sku").unwrap_or_default(),
            barcode: row.try_get("barcode").ok(),
            name: row.try_get("name").unwrap_or_default(),
            price_cents,
            tax_rate: row.try_get::<f64, _>("tax_rate").unwrap_or(10.0),
            category: row.try_get("category_id").unwrap_or_default(),
            description: row.try_get("description").ok(),
            in_stock: row.try_get::<bool, _>("is_active").unwrap_or(true),
            stock_quantity: row.try_get("stock_quantity").ok(),
            color: row.try_get("color").ok(),
            image_url: row.try_get("image_url").ok(),
        });
    }
    Ok(res)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SubmitOrderPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub items: Vec<CartItemDto>,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn submit_order(
    payload: SubmitOrderPayloadDto,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // 1. Calculate authoritative totals and prepared items
    struct PreparedOrderItem {
        id: String,
        product_id: String,
        quantity: i64,
        unit_price_cents: i64,
        tax_rate: f64,
        subtotal_cents: i64,
        tax_amount_cents: i64,
        total_cents: i64,
        modifiers_json: Option<String>,
    }

    let mut prepared_items: Vec<PreparedOrderItem> = Vec::with_capacity(payload.items.len());
    let mut total_cents: i64 = 0;

    for item in &payload.items {
        let product_id = item.product.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
            
        let row = sqlx::query("SELECT price_cents, tax_rate FROM products WHERE id=? AND tenant_id=?")
            .bind(product_id)
            .bind(&tenant_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Product not found: {}", e))?;
            
        let price_cents: i32 = row.try_get("price_cents").unwrap_or(0);
        let db_tax_rate: f64 = row.try_get::<f64, _>("tax_rate").unwrap_or(0.0);
        let qty = item.quantity;
        let mut item_unit_price = price_cents as i64;
        if let Some(m) = &item.modifiers {
            if let Some(arr) = m.as_array() {
                for mod_opt in arr {
                    if let Some(pc) = mod_opt.get("priceCents").and_then(|v| v.as_i64()) {
                        item_unit_price += pc;
                    }
                }
            }
        }
        let item_subtotal = item_unit_price * qty;
        let tax_rate_int = db_tax_rate.round() as i64;
        let item_tax = (item_subtotal * tax_rate_int) / 100;
        let item_total = item_subtotal + item_tax;
        total_cents += item_total;

        let modifiers_json = if let Some(m) = &item.modifiers {
            Some(serde_json::to_string(m).unwrap_or_default())
        } else {
            None
        };

        prepared_items.push(PreparedOrderItem {
            id: format!("item_{}", Uuid::new_v4()),
            product_id: product_id.to_string(),
            quantity: qty,
            unit_price_cents: item_unit_price,
            tax_rate: db_tax_rate,
            subtotal_cents: item_subtotal,
            tax_amount_cents: item_tax,
            total_cents: item_total,
            modifiers_json,
        });
    }

    // 2. Insert parent order first (satisfying FK constraint on order_items)
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, notes, created_at, updated_at) VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, datetime('now'), datetime('now'))")
        .bind(&payload.order_id)
        .bind(&payload.table_id)
        .bind(&tenant_id)
        .bind(total_cents)
        .bind(&payload.notes)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Insert child order_items with valid FK reference
    for p_item in prepared_items {
        sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents, modifiers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&p_item.id)
            .bind(&payload.order_id)
            .bind(&p_item.product_id)
            .bind(p_item.quantity)
            .bind(p_item.unit_price_cents)
            .bind(p_item.tax_rate)
            .bind(p_item.subtotal_cents)
            .bind(p_item.tax_amount_cents)
            .bind(p_item.total_cents)
            .bind(p_item.modifiers_json)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query("UPDATE tables SET status='OCCUPIED', current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')), opened_at = COALESCE(opened_at, datetime('now')) WHERE id=? AND tenant_id=?")
        .bind(&payload.table_id)
        .bind(&payload.table_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let event_id = format!("evt_order_{}", Uuid::new_v4());
    let event_payload = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "totalCents": total_cents,
        "itemCount": payload.items.len(),
    });
    let _ = sqlx::query("INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'ORDER', 'ORDER_SUBMITTED', ?, datetime('now'))")
        .bind(&event_id)
        .bind(&tenant_id)
        .bind(&payload.order_id)
        .bind(serde_json::to_string(&event_payload).unwrap_or_default())
        .execute(&mut *tx)
        .await;

    let outbox_id = format!("outbox_{}", Uuid::new_v4());
    let _ = sqlx::query("INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))")
        .bind(&outbox_id)
        .bind(&tenant_id)
        .bind(&event_id)
        .execute(&mut *tx)
        .await;

    // Sipariş açılışı denetim defterine yazılır: kayıt defterinde yoksa
    // iptal/ödeme kayıtlarının hangi siparişe ait olduğu izlenemez.
    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let audit_payload = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "totalCents": total_cents,
        "itemCount": payload.items.len(),
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "order:submitted",
        payload.order_id.clone(),
        audit_payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}


use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};

static FAILED_PIN_ATTEMPTS: AtomicU32 = AtomicU32::new(0);
static PIN_LOCKED_UNTIL: AtomicI64 = AtomicI64::new(0);

fn check_pin_rate_limit() -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let locked_until = PIN_LOCKED_UNTIL.load(Ordering::Relaxed);
    if now < locked_until {
        let remaining_secs = locked_until - now;
        return Err(format!(
            "RATE_LIMIT_EXCEEDED: Güvenlik nedeniyle terminal kilitlendi. Lütfen {} saniye sonra tekrar deneyin.",
            remaining_secs
        ));
    }
    Ok(())
}

fn record_failed_pin() {
    let attempts = FAILED_PIN_ATTEMPTS.fetch_add(1, Ordering::Relaxed) + 1;
    if attempts >= 5 {
        let lock_until = chrono::Utc::now().timestamp() + 300; // 5 dakika (300 saniye)
        PIN_LOCKED_UNTIL.store(lock_until, Ordering::Relaxed);
        FAILED_PIN_ATTEMPTS.store(0, Ordering::Relaxed);
    }
}

fn record_successful_pin() {
    FAILED_PIN_ATTEMPTS.store(0, Ordering::Relaxed);
    PIN_LOCKED_UNTIL.store(0, Ordering::Relaxed);
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UserDto {
    pub id: String,
    pub role: String,
    pub name: String,
    pub tenant_id: String,
    #[serde(rename = "activeModules", skip_serializing_if = "Option::is_none")]
    pub active_modules: Option<Vec<String>>,
}

async fn user_dto_with_modules(pool: &DbPool, row: &sqlx::sqlite::SqliteRow) -> UserDto {
    let tenant_id: String = row.try_get("tenant_id").unwrap_or_else(|_| "DEFAULT_TENANT".to_string());
    let module_rows = sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
        .bind(&tenant_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let active_modules: Vec<String> = module_rows
        .into_iter()
        .map(|r| r.try_get("module_id").unwrap_or_default())
        .collect();

    UserDto {
        id: row.try_get("id").unwrap_or_default(),
        role: row.try_get("role").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        tenant_id,
        active_modules: Some(active_modules),
    }
}

/// Authenticates an exact, provisioned login identifier.  Names and roles are
/// deliberately not identifiers: neither is stable nor secret.
pub async fn authenticate_by_identifier(pool: &DbPool, identifier: &str, secret: &str) -> Result<UserDto, String> {
    let identifier = identifier.trim();
    if identifier.is_empty() || secret.is_empty() {
        return Err("Geçersiz kimlik bilgileri".to_string());
    }

    // İlk olarak platform_admins tablosuna bak (MASTER yetkisi için).
    // Sütun `pin_hash`: düz metin `pin` kaldırıldı, yalnızca Argon2id PHC kabul edilir.
    let admin_row = sqlx::query(
        "SELECT id, name, pin_hash FROM platform_admins WHERE email = ? COLLATE NOCASE",
    )
    .bind(identifier)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = admin_row {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(secret, hash),
            None => false,
        };

        if is_valid {
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: "DEFAULT_TENANT".to_string(),
                active_modules: Some(vec![
                    "feat_kds".into(), "feat_qr_menu".into(), "feat_delivery".into(),
                    "feat_caller_id".into(), "feat_table_order".into(), "feat_seat_split".into(),
                    "feat_recipe_bom".into(), "feat_dynamic_pricing".into(), "feat_ledger_cari".into(),
                    "feat_multi_branch".into(), "feat_loss_radar".into(),
                ]),
            });
        }
    }

    let row = sqlx::query(
        "SELECT id, role, name, tenant_id, credential_hash FROM users WHERE is_active = 1 AND (login_identifier = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR id = ?)",
    )
    .bind(identifier)
    .bind(identifier)
    .bind(identifier)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        return Err("Geçersiz kimlik bilgileri".to_string());
    };
    // Yalnızca Argon2 hash'i kabul edilir; düz metin PIN sütunu artık yoktur ve
    // migration'da hash'e çevrilmiştir. Argon2 olmayan bir hash "eşleşme" sayılmaz.
    let hash: Option<String> = row.try_get("credential_hash").ok().flatten();
    let is_valid = match hash.as_deref() {
        Some(hash) if crate::user_credentials::is_argon2_hash(hash) => {
            crate::auth::verify_credential(secret, hash)
        }
        _ => false,
    };

    if !is_valid {
        return Err("Geçersiz kimlik bilgileri".to_string());
    }
    Ok(user_dto_with_modules(pool, &row).await)
}

/// PIN entry remains supported for restaurant workstations.  PINs are checked
/// against salted Argon2 hashes when available, with safe fallback to provisioned PINs.
/// PIN ile kimlik doğrulama — Restoran çalışma istasyonları için.
/// Multi-tenant izolasyonu: Eğer tenant_id belirtilmişse, öncelikle o işletmeye ait personel aranır.
pub async fn authenticate_by_pin(pool: &DbPool, pin: &str, target_tenant_id: Option<&str>) -> Result<UserDto, String> {
    // PIN brute force koruması
    check_pin_rate_limit()?;

    // PIN uzunluğu en az 4, en fazla 8 hane ve tamamen rakamlardan oluşmalıdır
    if !pin.chars().all(|character| character.is_ascii_digit()) || !(4..=8).contains(&pin.len()) {
        record_failed_pin();
        return Err("Geçersiz PIN".to_string());
    }

    // İlk olarak platform_admins kontrol et (MASTER her işletmede geçerlidir).
    // `pin_hash` sütunu Argon2id tutar; düz metin karşılaştırması yoktur.
    let admin_rows = sqlx::query("SELECT id, name, pin_hash FROM platform_admins")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    for row in admin_rows {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(pin, hash),
            None => false,
        };

        if is_valid {
            record_successful_pin();
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: target_tenant_id.unwrap_or("DEFAULT_TENANT").to_string(),
                active_modules: Some(vec![
                    "feat_kds".into(), "feat_qr_menu".into(), "feat_delivery".into(),
                    "feat_caller_id".into(), "feat_table_order".into(), "feat_seat_split".into(),
                    "feat_recipe_bom".into(), "feat_dynamic_pricing".into(), "feat_ledger_cari".into(),
                    "feat_multi_branch".into(), "feat_loss_radar".into(),
                ]),
            });
        }
    }

    // Multi-tenant PIN çakışmasını engelle (Cross-Tenant PIN Fallthrough Koruması):
    // tenant belirtilmişse yalnızca o tenant taranır, bulunamazsa hiçbir başka
    // kiracıya düşülmez. Tenant belirtilmemişse yalnızca DEFAULT_TENANT denenir —
    // bu, tüm veritabanını taramakla aynı şey değildir.
    let effective_tenant = match target_tenant_id {
        Some(tenant) if !tenant.is_empty() => tenant,
        _ => "DEFAULT_TENANT",
    };

    // PIN düz metin olmadığı için `WHERE pin = ?` yerine aday satırlar Argon2 ile
    // doğrulanır. Bu tarama `user_credentials` içinde tek yerde yaşar.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let matched = crate::user_credentials::find_user_by_pin(&mut conn, pin, Some(effective_tenant)).await?;
    drop(conn);

    match matched {
        Some(found) => {
            record_successful_pin();
            let row = sqlx::query("SELECT id, role, name, tenant_id FROM users WHERE id = ?")
                .bind(&found.id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(user_dto_with_modules(pool, &row).await)
        }
        None => {
            record_failed_pin();
            Err("Geçersiz PIN".to_string())
        }
    }
}

#[tauri::command]
pub async fn auth_login_credentials(identifier: String, secret: String, pool: tauri::State<'_, DbPool>) -> Result<UserDto, String> {
    authenticate_by_identifier(&pool, &identifier, &secret).await
}

#[tauri::command]
pub async fn auth_login(
    pin: String,
    tenant_id: Option<String>,
    #[allow(non_snake_case)]
    tenantId: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<UserDto, String> {
    let effective_tenant = tenant_id.or(tenantId);
    authenticate_by_pin(&pool, &pin, effective_tenant.as_deref()).await
}

#[tauri::command]
pub async fn change_self_pin(
    user_id: String,
    current_pin: Option<String>,
    new_pin: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    // PIN 4 ila 8 haneli sayısal olmalıdır
    if !new_pin.chars().all(|c| c.is_ascii_digit()) || !(4..=8).contains(&new_pin.len()) {
        return Err("Yeni PIN 4-8 haneli sayısal olmalıdır.".into());
    }

    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Mevcut PIN gönderilmişse Argon2 üzerinden doğrula.
    if let Some(ref cur_pin) = current_pin {
        if !crate::user_credentials::verify_user_pin(&mut conn, &user_id, cur_pin).await? {
            return Err("Mevcut PIN hatalı.".to_string());
        }
    }

    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Yeni PIN'i hash'le ve yalnızca hash'ini yaz: düz metin hiçbir yere gitmez.
    let hash = crate::user_credentials::hash_pin(&new_pin)?;

    // PIN benzersizliği kontrolü ve yazma aynı transaction içinde.
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    crate::user_credentials::ensure_pin_available(&mut *tx, &tenant_id, &new_pin, Some(&user_id)).await?;

    sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    crate::user_credentials::ensure_pin_unique_after_write(&mut *tx, &tenant_id, &new_pin, &user_id).await?;

    // Kimlik bilgisi değişikliği "Güvenlik" kategorisine yazılır. Deftere PIN'in
    // kendisi ya da hash'i girmez; yalnızca değişikliğin gerçekleştiği yazılır.
    let user_role: String =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or_else(|_| "System".to_string());

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        user_id.clone(),
        user_role,
        crate::services::audit_service::category::GUVENLIK,
        "security:pin_changed",
        user_id.clone(),
        serde_json::json!({ "userId": user_id, "method": "self_service" }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "user_id": user_id,
        "new_pin": new_pin,
    }))
}

#[tauri::command]
pub async fn add_table(
    id: String,
    name: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES (?, ?, ?, 'AVAILABLE', 0)")
        .bind(&id)
        .bind(&tenant_id)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "id": id,
        "name": name
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:add",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_table(
    id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let tenant_id = table_tenant(&mut tx, &id).await;

    sqlx::query("DELETE FROM tables WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "id": id
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:remove",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Masa adı değişikliği "Eski Değer → Yeni Değer" sütununu besleyen ilk
/// kayıttır: değişiklik `changes` nesnesiyle payload'a yazılır.
#[tauri::command]
pub async fn update_table_name(
    id: String,
    name: String,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let previous_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM tables WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tenant_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE tables SET name = ? WHERE id = ? AND tenant_id = ?")
        .bind(&name)
        .bind(&id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "tableId": id,
        "changes": {
            "name": { "old": previous_name, "new": name }
        }
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:renamed",
        id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DailySummaryDto {
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub payment_methods: std::collections::HashMap<String, i64>,
}

#[tauri::command]
pub async fn get_daily_summary(
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<DailySummaryDto, String> {
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier])?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Ciro ve ödeme yöntemi dağılımı tenant'a göre daraltılır: defter tek bir
    // zincirde tutulduğu için filtresiz sorgu tüm işletmelerin cirosunu toplardı.
    let row = sqlx::query("SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count FROM orders WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED') AND created_at >= date('now', 'start of day')")
        .bind(&tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let total_revenue_cents: i64 = row.try_get("total").unwrap_or(0);
    let total_orders: i64 = row.try_get("count").unwrap_or(0);

    let methods_rows = sqlx::query(
        "SELECT json_extract(payload, '$.method') as method, COALESCE(sum(json_extract(payload, '$.totalAmount')), 0) as amount 
         FROM audit_ledger 
         WHERE tenant_id = ? AND action='payment:settled_fifo' AND created_at >= date('now', 'start of day')
         GROUP BY json_extract(payload, '$.method')"
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut payment_methods = std::collections::HashMap::new();
    for r in methods_rows {
        if let Ok(method) = r.try_get::<String, _>("method") {
            // totalAmount in audit_ledger payload is stored as integer cents — read directly.
            let amount_cents: i64 = r.try_get("amount").unwrap_or(0);
            payment_methods.insert(method, amount_cents);
        }
    }

    Ok(DailySummaryDto {
        total_revenue_cents,
        total_orders,
        payment_methods,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReceiptItemDto {
    pub id: String,
    #[serde(rename = "productId", alias = "product_id")]
    pub product_id: String,
    #[serde(rename = "productName", alias = "product_name")]
    pub product_name: String,
    pub quantity: i64,
    #[serde(rename = "unitPriceCents", alias = "unit_price_cents")]
    pub unit_price_cents: i64,
    #[serde(rename = "taxRate", alias = "tax_rate")]
    pub tax_rate: f64,
    #[serde(rename = "subtotalCents", alias = "subtotal_cents")]
    pub subtotal_cents: i64,
    #[serde(rename = "taxAmountCents", alias = "tax_amount_cents")]
    pub tax_amount_cents: i64,
    #[serde(rename = "totalCents", alias = "total_cents")]
    pub total_cents: i64,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReceiptDto {
    pub id: String,
    #[serde(rename = "table_id", alias = "tableId")]
    pub table_id: String,
    #[serde(rename = "total_cents", alias = "totalCents")]
    pub total_cents: i64,
    #[serde(rename = "subtotal_cents", alias = "subtotalCents")]
    pub subtotal_cents: i64,
    #[serde(rename = "tax_total_cents", alias = "taxTotalCents")]
    pub tax_total_cents: i64,
    #[serde(rename = "discount_cents", alias = "discountCents")]
    pub discount_cents: i64,
    #[serde(rename = "created_at", alias = "createdAt")]
    pub created_at: String,
    #[serde(rename = "cashier_id", alias = "cashierId")]
    pub cashier_id: Option<String>,
    #[serde(rename = "cashier_name", alias = "cashierName")]
    pub cashier_name: Option<String>,
    #[serde(rename = "payment_method", alias = "paymentMethod")]
    pub payment_method: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub items: Vec<ReceiptItemDto>,
    #[serde(rename = "tendered_cents", alias = "tenderedCents")]
    pub tendered_cents: Option<i64>,
    #[serde(rename = "change_cents", alias = "changeCents")]
    pub change_cents: Option<i64>,
}

#[tauri::command]
pub async fn get_receipts(pool: tauri::State<'_, DbPool>) -> Result<Vec<ReceiptDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // 1. Fetch closed/paid orders from orders table
    let rows = sqlx::query("SELECT id, table_id, total_cents, created_at, cashier_id, notes FROM orders WHERE status IN ('PAID', 'CLOSED') ORDER BY created_at DESC")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch user map for cashier names
    let user_rows = sqlx::query("SELECT id, name FROM users")
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();
    let mut user_map = std::collections::HashMap::new();
    for ur in user_rows {
        let uid: String = ur.try_get("id").unwrap_or_default();
        let uname: String = ur.try_get("name").unwrap_or_default();
        user_map.insert(uid, uname);
    }

    // Fetch table map for table names
    let table_rows = sqlx::query("SELECT id, name FROM tables")
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();
    let mut table_map = std::collections::HashMap::new();
    for tr in table_rows {
        let tid: String = tr.try_get("id").unwrap_or_default();
        let tname: String = tr.try_get("name").unwrap_or_default();
        table_map.insert(tid, tname);
    }

    // Fetch all sale events to correlate payment method & tendered/change
    let sale_event_rows = sqlx::query("SELECT aggregate_id, payload FROM events WHERE aggregate_type = 'SALE' AND event_type = 'SALE_SETTLED'")
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();
    let mut event_map = std::collections::HashMap::new();
    for er in &sale_event_rows {
        let agg_id: String = er.try_get("aggregate_id").unwrap_or_default();
        let payload_str: String = er.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            let order_id = v.get("orderId").and_then(|x| x.as_str()).unwrap_or("");
            if !order_id.is_empty() {
                event_map.insert(order_id.to_string(), v.clone());
            }
            if !agg_id.is_empty() {
                event_map.insert(agg_id, v);
            }
        }
    }

    let mut receipts = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for r in rows {
        let order_id: String = r.try_get("id").unwrap_or_default();
        let raw_table_id: String = r.try_get("table_id").unwrap_or_default();
        let table_display = table_map.get(&raw_table_id).cloned().unwrap_or(raw_table_id.clone());
        let total_cents: i64 = r.try_get("total_cents").unwrap_or(0);
        let created_at: String = r.try_get("created_at").unwrap_or_default();
        let cashier_id: Option<String> = r.try_get("cashier_id").ok();
        let notes: Option<String> = r.try_get("notes").ok();

        let cashier_name = cashier_id.as_ref().and_then(|cid| user_map.get(cid)).cloned();

        // Fetch order items
        let item_rows = sqlx::query("
            SELECT oi.id, oi.product_id, COALESCE(p.name, oi.product_id) as product_name, 
                   oi.quantity, oi.unit_price_cents, oi.tax_rate, oi.subtotal_cents, 
                   oi.tax_amount_cents, oi.total_cents, oi.modifiers, oi.notes
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        ")
        .bind(&order_id)
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();

        let mut items = Vec::new();
        let mut subtotal_calc: i64 = 0;
        let mut tax_calc: i64 = 0;
        let mut gross_calc: i64 = 0;

        for ir in item_rows {
            let qty: i64 = ir.try_get("quantity").unwrap_or(1);
            let unit_price: i64 = ir.try_get("unit_price_cents").unwrap_or(0);
            let subtotal: i64 = ir.try_get("subtotal_cents").unwrap_or(unit_price * qty);
            let tax_amount: i64 = ir.try_get("tax_amount_cents").unwrap_or(0);
            let item_total: i64 = ir.try_get("total_cents").unwrap_or(subtotal + tax_amount);
            let tax_rate: f64 = ir.try_get("tax_rate").unwrap_or(10.0);
            let modifiers_str: Option<String> = ir.try_get("modifiers").ok();
            let item_notes: Option<String> = ir.try_get("notes").ok();
            let modifiers: Vec<String> = if let Some(m) = modifiers_str {
                serde_json::from_str(&m).unwrap_or_default()
            } else {
                Vec::new()
            };

            subtotal_calc += subtotal;
            tax_calc += tax_amount;
            gross_calc += unit_price * qty;

            items.push(ReceiptItemDto {
                id: ir.try_get("id").unwrap_or_default(),
                product_id: ir.try_get("product_id").unwrap_or_default(),
                product_name: ir.try_get("product_name").unwrap_or_default(),
                quantity: qty,
                unit_price_cents: unit_price,
                tax_rate,
                subtotal_cents: subtotal,
                tax_amount_cents: tax_amount,
                total_cents: item_total,
                modifiers,
                notes: item_notes,
            });
        }

        // Correlate with event if available
        let event_val = event_map.get(&order_id);
        let payment_method = event_val
            .and_then(|v| v.get("method").and_then(|m| m.as_str()))
            .map(|m| match m {
                "CASH" => "Nakit",
                "CREDIT_CARD" => "Kredi Kartı",
                "SPLIT" => "Parçalı",
                other => other,
            })
            .unwrap_or("Nakit")
            .to_string();

        let tendered_cents = event_val
            .and_then(|v| v.get("amountTendered").and_then(|a| a.as_i64()));
        let change_cents = event_val
            .and_then(|v| v.get("changeAmount").and_then(|c| c.as_i64()));

        let discount_cents = if gross_calc > total_cents && gross_calc > 0 {
            gross_calc - total_cents
        } else {
            0
        };

        let final_subtotal = if subtotal_calc > 0 { subtotal_calc } else { (total_cents * 100) / 110 };
        let final_tax = if tax_calc > 0 { tax_calc } else { total_cents - final_subtotal };

        seen_ids.insert(order_id.clone());
        receipts.push(ReceiptDto {
            id: order_id,
            table_id: table_display,
            total_cents,
            subtotal_cents: final_subtotal,
            tax_total_cents: final_tax,
            discount_cents,
            created_at,
            cashier_id,
            cashier_name,
            payment_method,
            notes,
            items,
            tendered_cents,
            change_cents,
        });
    }

    // Also include standalone SALE_SETTLED events not in orders
    for er in &sale_event_rows {
        let payload_str: String = er.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            let tx_id = v.get("transactionId").and_then(|x| x.as_str()).unwrap_or("");
            let ord_id = v.get("orderId").and_then(|x| x.as_str()).unwrap_or(tx_id);
            if !ord_id.is_empty() && !seen_ids.contains(ord_id) {
                seen_ids.insert(ord_id.to_string());
                let total = v.get("totalAmount").and_then(|x| x.as_i64()).unwrap_or(0);
                let timestamp = v.get("timestamp").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let customer_ref = v.get("customerRef").and_then(|x| x.as_str()).unwrap_or("Kasa Satışı");
                let cashier = v.get("cashierId").and_then(|x| x.as_str()).map(|s| s.to_string());
                let method = v.get("method").and_then(|x| x.as_str()).unwrap_or("CASH");
                let method_tr = match method {
                    "CASH" => "Nakit",
                    "CREDIT_CARD" => "Kredi Kartı",
                    "SPLIT" => "Parçalı",
                    other => other,
                };
                let tendered = v.get("amountTendered").and_then(|x| x.as_i64());
                let change = v.get("changeAmount").and_then(|x| x.as_i64());
                let notes = v.get("notes").and_then(|x| x.as_str()).map(|s| s.to_string());

                let mut items = Vec::new();
                let mut sub_cents: i64 = 0;
                let mut tax_cents: i64 = 0;
                if let Some(raw_items) = v.get("items").and_then(|x| x.as_array()) {
                    for it in raw_items {
                        let name = it.get("product").and_then(|p| p.get("name")).and_then(|n| n.as_str()).unwrap_or("Ürün");
                        let pid = it.get("product").and_then(|p| p.get("id")).and_then(|n| n.as_str()).unwrap_or("");
                        let q = it.get("quantity").and_then(|x| x.as_i64()).unwrap_or(1);
                        let up = it.get("unitPrice").and_then(|x| x.as_i64()).unwrap_or(0);
                        let tr = it.get("taxRate").and_then(|x| x.as_f64()).unwrap_or(10.0);
                        let sub = it.get("subtotal").and_then(|x| x.as_i64()).unwrap_or(up * q);
                        let ta = it.get("taxAmount").and_then(|x| x.as_i64()).unwrap_or(0);
                        let tot = it.get("total").and_then(|x| x.as_i64()).unwrap_or(sub + ta);
                        let item_note = it.get("note").and_then(|x| x.as_str()).map(|s| s.to_string());

                        sub_cents += sub;
                        tax_cents += ta;

                        items.push(ReceiptItemDto {
                            id: format!("item_{}", Uuid::new_v4()),
                            product_id: pid.to_string(),
                            product_name: name.to_string(),
                            quantity: q,
                            unit_price_cents: up,
                            tax_rate: tr,
                            subtotal_cents: sub,
                            tax_amount_cents: ta,
                            total_cents: tot,
                            modifiers: vec![],
                            notes: item_note,
                        });
                    }
                }

                receipts.push(ReceiptDto {
                    id: ord_id.to_string(),
                    table_id: table_map.get(customer_ref).cloned().unwrap_or_else(|| customer_ref.to_string()),
                    total_cents: total,
                    subtotal_cents: if sub_cents > 0 { sub_cents } else { (total * 100) / 110 },
                    tax_total_cents: if tax_cents > 0 { tax_cents } else { total - sub_cents },
                    discount_cents: 0,
                    created_at: timestamp,
                    cashier_id: cashier.clone(),
                    cashier_name: cashier.as_ref().and_then(|cid| user_map.get(cid)).cloned(),
                    payment_method: method_tr.to_string(),
                    notes,
                    items,
                    tendered_cents: tendered,
                    change_cents: change,
                });
            }
        }
    }

    Ok(receipts)
}

#[tauri::command]
pub async fn get_receipt_details(
    receipt_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Option<ReceiptDto>, String> {
    let receipts = get_receipts(pool).await?;
    Ok(receipts.into_iter().find(|r| r.id == receipt_id))
}


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VoidOrderPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "actorRole")]
    pub actor_role: String,
    #[serde(rename = "managerPin")]
    pub manager_pin: Option<String>,
}

#[tauri::command]
pub async fn void_order(
    payload: VoidOrderPayloadDto,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Yetki (SPEC §34 "Void Onaylama"): kapı yasaklı rolleri sayan değil, yetkili
    // rolleri kabul eden bir eşleşmedir. Önceki hâli "rol CASHIER/WAITER/KITCHEN
    // değilse geç" mantığıydı; bu yüzden MASTER ve veritabanında karşılığı olmayan
    // bir rol doğrudan void edebiliyordu (fail-open).
    let actor_role = crate::rbac::canonical_role(&payload.actor_role)
        .ok_or_else(|| "UNAUTHORIZED: Bilinmeyen rol".to_string())?;

    match actor_role {
        crate::rbac::Role::Owner | crate::rbac::Role::Manager => {}
        crate::rbac::Role::Cashier | crate::rbac::Role::Waiter => {
            let pin = payload.manager_pin.ok_or("Manager approval PIN is required for voids")?;

            // Onaylayanın PIN'i düz metin olmadığı için `WHERE pin = ?` yerine
            // tenant içindeki adaylar Argon2 ile doğrulanır.
            let found = crate::user_credentials::find_user_by_pin(&mut tx, &pin, Some(&tenant_id)).await?;

            let manager = found.ok_or("Invalid manager PIN")?;
            let m_id = manager.id;

            // SPEC'te Void Onaylama yalnızca sahip ve müdüre açıktır.
            let approver = crate::rbac::canonical_role(&manager.role)
                .ok_or_else(|| "Invalid manager PIN or insufficient permissions".to_string())?;
            if !matches!(approver, crate::rbac::Role::Owner | crate::rbac::Role::Manager) {
                return Err("Invalid manager PIN or insufficient permissions".into());
            }

            // Onayı denetim izine yaz
            let approval_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO approvals (id, tenant_id, request_type, resource_id, requester_id, status, approver_id, payload, resolved_at)
                 VALUES (?, ?, 'VOID_ORDER', ?, ?, 'APPROVED', ?, ?, datetime('now'))"
            )
            .bind(&approval_id)
            .bind(&tenant_id)
            .bind(&payload.order_id)
            .bind(&payload.actor_id)
            .bind(&m_id)
            .bind(&payload.reason)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
        crate::rbac::Role::Master | crate::rbac::Role::Kitchen => {
            return Err("UNAUTHORIZED: Bu rol sipariş iptali yapamaz".into());
        }
    }

    // Ödenmiş veya kapatılmış siparişlerin iptal edilmesini kesinlikle engelle (P0 Güvenlik Kilidi)
    let current_order = sqlx::query("SELECT status FROM orders WHERE id = ? AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
        .bind(&payload.order_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = current_order {
        let st: String = r.try_get("status").unwrap_or_default();
        let upper_st = st.to_uppercase();
        if upper_st == "PAID" || upper_st == "CLOSED" {
            return Err("CANNOT_VOID_PAID_ORDER: Ödenmiş veya kapatılmış siparişler iptal edilemez.".to_string());
        }
    }

    sqlx::query(
        "UPDATE orders SET status = 'VOID', notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?), updated_at = datetime('now') WHERE ((id = ? AND status NOT IN ('PAID', 'CLOSED', 'VOID')) OR (table_id = ? AND status IN ('OPEN', 'IN_PROGRESS'))) AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')"
    )
    .bind(&payload.reason)
    .bind(&payload.reason)
    .bind(&payload.order_id)
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let count_row = sqlx::query(
        "SELECT COUNT(*) as count FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND tenant_id = ?"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let remaining: i64 = count_row.try_get("count").unwrap_or(0);

    if remaining == 0 {
        sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0 WHERE id = ? AND tenant_id = ?")
            .bind(&payload.table_id)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let payload_val = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "reason": payload.reason,
    });

    // İptal denetimde "Güvenlik" kategorisindedir: para hareketini tersine çevirir
    // ve yetkisi rol tarafından doğrulanmıştır. Rol burada sabit "Cashier"
    // yazılmaz; gerçek, kanonik rol kaydedilir.
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        payload.actor_id.clone(),
        actor_role.as_str().to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "order:voided",
        payload.order_id.clone(),
        payload_val,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}

/// Denetim kaydının istemciye giden hali.
///
/// `current_hash` **bilerek yoktur**: ham SHA-256 değeri ne API'den ne arayüzden
/// çıkar (AGENTS.md §3.2). Arayüzün göstereceği tek şey `sealed` mührüdür.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuditLogDto {
    pub id: String,
    pub sequence: i64,
    pub timestamp: String,
    pub actor_id: String,
    pub actor_role: String,
    pub category: String,
    pub action: String,
    pub resource_id: String,
    pub payload: serde_json::Value,
    pub sealed: bool,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct AuditLogFilterDto {
    #[serde(rename = "actorId", default)]
    pub actor_id: Option<String>,
    pub category: Option<String>,
    #[serde(rename = "startDate", default)]
    pub start_date: Option<String>,
    #[serde(rename = "endDate", default)]
    pub end_date: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub async fn get_audit_logs(
    caller_role: String,
    tenant_id: String,
    filter: Option<AuditLogFilterDto>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<AuditLogDto>, String> {
    // Bu komut önceden hiç rol kapısı taşımıyordu; garson ve mutfak da tüm
    // tenant'ların denetim kayıtlarını okuyabiliyordu.
    crate::rbac::require_audit_read(&caller_role)?;

    let filter = filter.unwrap_or_default();

    if let Some(category) = filter.category.as_deref() {
        if !crate::services::audit_service::category::is_valid(category) {
            return Err(format!("UNKNOWN_AUDIT_CATEGORY: '{}'", category));
        }
    }

    // LIMIT her zaman bağlı değişkenle gelir; istekten gelen sayı makul bir
    // tavanla sınırlanır.
    const MAX_LIMIT: i64 = 500;
    let limit = filter.limit.unwrap_or(100).clamp(1, MAX_LIMIT);
    let offset = filter.offset.unwrap_or(0).max(0);

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Sorgu `QueryBuilder` ile kurulur: değerler her zaman bağlı değişkenle gider,
    // hiçbir filtre değeri SQL metnine gömülmez.
    let mut builder = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT id, sequence, timestamp, actor_id, actor_role, category, action, resource_id, payload \
         FROM audit_ledger WHERE tenant_id = ",
    );
    builder.push_bind(tenant_id);

    if let Some(actor_id) = filter.actor_id.as_deref() {
        builder.push(" AND actor_id = ");
        builder.push_bind(actor_id.to_string());
    }
    if let Some(category) = filter.category.as_deref() {
        builder.push(" AND category = ");
        builder.push_bind(category.to_string());
    }
    if let Some(start_date) = filter.start_date.as_deref() {
        builder.push(" AND timestamp >= ");
        builder.push_bind(start_date.to_string());
    }
    if let Some(end_date) = filter.end_date.as_deref() {
        builder.push(" AND timestamp <= ");
        builder.push_bind(end_date.to_string());
    }
    if let Some(search) = filter.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        builder.push(" AND (action LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(" OR resource_id LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(" OR actor_id LIKE ");
        builder.push_bind(format!("%{}%", search));
        builder.push(")");
    }

    builder.push(" ORDER BY sequence DESC LIMIT ");
    builder.push_bind(limit);
    builder.push(" OFFSET ");
    builder.push_bind(offset);

    let rows = builder
        .build()
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut logs = Vec::with_capacity(rows.len());
    for r in rows {
        logs.push(AuditLogDto {
            id: r.try_get("id").unwrap_or_default(),
            sequence: r.try_get("sequence").unwrap_or(0),
            timestamp: r.try_get("timestamp").unwrap_or_default(),
            actor_id: r.try_get("actor_id").unwrap_or_default(),
            actor_role: r.try_get("actor_role").unwrap_or_default(),
            category: r.try_get("category").unwrap_or_default(),
            action: r.try_get("action").unwrap_or_default(),
            resource_id: r.try_get("resource_id").unwrap_or_default(),
            payload: r
                .try_get::<String, _>("payload")
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .unwrap_or(serde_json::Value::Null),
            sealed: true,
        });
    }

    Ok(logs)
}

#[tauri::command]
pub async fn print_receipt(
    order: serde_json::Value,
) -> Result<(), String> {
    println!("\n================================================");
    println!("             *** KASAM360 ADİSYON ***           ");
    println!("              ESC/POS 80mm TERMAL FİŞ           ");
    println!("================================================");

    if let Some(obj) = order.as_object() {
        let id = obj.get("id").or_else(|| obj.get("orderId")).and_then(|v| v.as_str()).unwrap_or("N/A");
        let table = obj.get("table_id").or_else(|| obj.get("tableId")).or_else(|| obj.get("customerRef")).and_then(|v| v.as_str()).unwrap_or("N/A");
        let cashier = obj.get("cashier_name")
            .or_else(|| obj.get("cashierName"))
            .or_else(|| obj.get("cashier_id"))
            .or_else(|| obj.get("cashierId"))
            .and_then(|v| v.as_str())
            .unwrap_or("Kasiyer");
        let date = obj.get("created_at").or_else(|| obj.get("createdAt")).or_else(|| obj.get("timestamp")).and_then(|v| v.as_str()).unwrap_or("N/A");
        let method = obj.get("payment_method").or_else(|| obj.get("paymentMethod")).or_else(|| obj.get("method")).and_then(|v| v.as_str()).unwrap_or("NAKİT");
        let total = obj.get("total_cents").or_else(|| obj.get("totalCents")).or_else(|| obj.get("totalAmount")).and_then(|v| v.as_i64()).unwrap_or(0);
        let subtotal = obj.get("subtotal_cents").or_else(|| obj.get("subtotalCents")).and_then(|v| v.as_i64()).unwrap_or(total);
        let tax = obj.get("tax_total_cents").or_else(|| obj.get("taxTotalCents")).and_then(|v| v.as_i64()).unwrap_or(0);
        let discount = obj.get("discount_cents").or_else(|| obj.get("discountCents")).and_then(|v| v.as_i64()).unwrap_or(0);

        println!("Fiş No   : {}", id);
        println!("Masa     : {}", table);
        println!("Kasiyer  : {}", cashier);
        println!("Tarih    : {}", date);
        println!("Ödeme    : {}", method);
        println!("------------------------------------------------");
        println!("{:<22} {:>4} {:>9} {:>9}", "ÜRÜN", "ADET", "FİYAT", "TUTAR");
        println!("------------------------------------------------");

        if let Some(items) = obj.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let name = item.get("product_name")
                    .or_else(|| item.get("productName"))
                    .or_else(|| item.get("product").and_then(|p| p.get("name")))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Ürün");
                let qty = item.get("quantity").and_then(|v| v.as_i64()).unwrap_or(1);
                let price = item.get("unit_price_cents")
                    .or_else(|| item.get("unitPriceCents"))
                    .or_else(|| item.get("unitPrice"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let line_total = item.get("total_cents")
                    .or_else(|| item.get("totalCents"))
                    .or_else(|| item.get("total"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(price * qty);

                let short_name = if name.len() > 22 { &name[..22] } else { name };
                println!("{:<22} {:>4} {:>7.2}TL {:>7.2}TL", 
                    short_name, qty, (price as f64) / 100.0, (line_total as f64) / 100.0);
            }
        }
        println!("------------------------------------------------");
        if discount > 0 {
            println!("ARA TOPLAM:                           {:>7.2} TL", (subtotal as f64) / 100.0);
            println!("İNDİRİM:                             -{:>7.2} TL", (discount as f64) / 100.0);
        }
        if tax > 0 {
            println!("HESAPLANAN KDV:                       {:>7.2} TL", (tax as f64) / 100.0);
        }
        println!("GENEL TOPLAM:                         {:>7.2} TL", (total as f64) / 100.0);
        if let Some(tendered) = obj.get("tendered_cents").or_else(|| obj.get("tenderedCents")).and_then(|v| v.as_i64()) {
            println!("Tahsil Edilen ({}):            {:>7.2} TL", method, (tendered as f64) / 100.0);
            if let Some(change) = obj.get("change_cents").or_else(|| obj.get("changeCents")).and_then(|v| v.as_i64()) {
                println!("Para Üstü:                            {:>7.2} TL", (change as f64) / 100.0);
            }
        }
        println!("================================================");
        println!("       MALİ DEĞERİ YOKTUR - BİLGİ FİŞİDİR       ");
        println!("         Bizi Tercih Ettiğiniz İçin             ");
        println!("              TEŞEKKÜR EDERİZ!                  ");
        println!("================================================\n");
    } else {
        println!("PRINTING RECEIPT: {:?}", order);
    }
    Ok(())
}


#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShiftDto {
    pub id: String,
    pub tenant_id: String,
    pub cashier_id: String,
    pub status: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub expected_amount_cents: i32,
    pub actual_amount_cents: Option<i32>,
    pub difference_cents: Option<i32>,
}

#[tauri::command]
pub async fn open_shift(
    cashier_id: String,
    expected_amount_cents: i32,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    // Check if open shift exists
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?")
        .bind(&cashier_id)
        .bind(&tenant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        
    if count > 0 {
        return Err("Vardiya zaten açık (Shift already open)".into());
    }
    
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) VALUES (?, ?, ?, 'OPEN', datetime('now'), ?)")
        .bind(&id)
        .bind(&tenant_id)
        .bind(&cashier_id)
        .bind(expected_amount_cents)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:opened",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "expectedAmountCents": expected_amount_cents,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
        
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "OPEN".into(),
        opened_at: chrono::Utc::now().to_rfc3339(),
        closed_at: None,
        expected_amount_cents,
        actual_amount_cents: None,
        difference_cents: None
    })
}

#[tauri::command]
pub async fn close_shift(
    cashier_id: String,
    actual_amount_cents: i32,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ShiftDto, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    // Find open shift
    let row = sqlx::query("SELECT id, expected_amount_cents, tenant_id FROM shifts WHERE cashier_id = ? AND status = 'OPEN' AND tenant_id = ?")
        .bind(&cashier_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        
    let r = row.ok_or("Aktif açık vardiya bulunamadı (No active open shift found)")?;
    let id: String = r.try_get("id").unwrap_or_default();
    let expected: i32 = r.try_get("expected_amount_cents").unwrap_or(0);
    let shift_tenant: String = r
        .try_get("tenant_id")
        .unwrap_or_else(|_| tenant_id.clone());
    
    let difference = actual_amount_cents - expected;
    
    sqlx::query("UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'), actual_amount_cents = ?, difference_cents = ? WHERE id = ?")
        .bind(actual_amount_cents)
        .bind(difference)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Kasa kapanışı "Eski Değer → Yeni Değer" sütununun en kritik kaydıdır:
    // beklenen ile sayılan tutar ve fark burada görünür olur.
    let now_iso = chrono::Utc::now().to_rfc3339();
    let (_, actor_role) = audit_actor(None, actor_role);
    let ctx = crate::services::audit_service::AuditContext::new(
        shift_tenant,
        cashier_id.clone(),
        actor_role,
        crate::services::audit_service::category::FINANS,
        "shift:closed",
        id.clone(),
        serde_json::json!({
            "shiftId": id,
            "changes": {
                "expectedAmountCents": { "old": expected, "new": actual_amount_cents },
            },
            "differenceCents": difference,
        }),
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
        
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(ShiftDto {
        id,
        tenant_id,
        cashier_id,
        status: "CLOSED".into(),
        opened_at: "".into(),
        closed_at: Some(chrono::Utc::now().to_rfc3339()),
        expected_amount_cents: expected,
        actual_amount_cents: Some(actual_amount_cents),
        difference_cents: Some(difference)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// MASTER platform hesabı artık yalnızca Argon2 hash'iyle tanınır.
    /// Düz metin `pin` sütunu kaldırıldığı için eski `h == secret` fallback'i
    /// hem gereksiz hem de tehlikelidir: bir hash yerine düz metin kalmış bir
    /// veritabanında kimlik doğrulama bypass edilirdi.
    #[tokio::test]
    async fn platform_admin_kimlik_dogrulamasi_argon2_ile_calisir_duz_metni_kabul_etmez() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin_hash TEXT,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Hash'li MASTER hesabı doğru kimlikle giriş yapabilir.
        let hash = crate::auth::hash_credential("Master-3736!").unwrap();
        sqlx::query("INSERT INTO platform_admins (id, pin_hash, name, email) VALUES ('adm_1', ?, 'Süper Admin', 'master@kasam360.com')")
            .bind(&hash)
            .execute(&pool)
            .await
            .unwrap();

        let matched = authenticate_by_identifier(&pool, "master@kasam360.com", "Master-3736!").await;
        assert!(matched.is_ok(), "hash'li MASTER girişi başarısız: {:?}", matched.err());
        assert_eq!(matched.unwrap().role, "MASTER");

        // Yanlış kimlik reddedilir.
        assert!(authenticate_by_identifier(&pool, "master@kasam360.com", "yanlis").await.is_err());

        // Hash yerine düz metin kalmış bir satır kabul edilmez (fallback kaldırıldı).
        sqlx::query("UPDATE platform_admins SET pin_hash = 'Master-3736!' WHERE id = 'adm_1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            authenticate_by_identifier(&pool, "master@kasam360.com", "Master-3736!")
                .await
                .is_err(),
            "düz metn saklanan kimlik kabul edildi"
        );
    }

    /// `authenticate_by_pin` MASTER dalı da aynı kurala uyar.
    #[tokio::test]
    async fn platform_admin_pin_dogrulamasi_argon2_ile_calisir() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin_hash TEXT,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                credential_hash TEXT,
                pin_hash TEXT,
                login_identifier TEXT,
                email TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
             );
             CREATE TABLE tenant_modules (tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
             INSERT INTO platform_admins (id, pin_hash, name, email) VALUES ('adm_1', ?, 'Süper Admin', 'master@kasam360.com');",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE platform_admins SET pin_hash = ? WHERE id = 'adm_1'")
            .bind(crate::auth::hash_credential("7373").unwrap())
            .execute(&pool)
            .await
            .unwrap();

        let matched = authenticate_by_pin(&pool, "7373", Some("DEFAULT_TENANT")).await;
        assert!(matched.is_ok(), "hash'li MASTER PIN girişi başarısız: {:?}", matched.err());
        assert_eq!(matched.unwrap().role, "MASTER");

        assert!(authenticate_by_pin(&pool, "9999", Some("DEFAULT_TENANT")).await.is_err());

        // Düz metne dönen satır artık kabul edilmez.
        sqlx::query("UPDATE platform_admins SET pin_hash = '7373' WHERE id = 'adm_1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            authenticate_by_pin(&pool, "7373", Some("DEFAULT_TENANT")).await.is_err(),
            "düz metn saklanan MASTER PIN kabul edildi"
        );
    }

    #[test]
    fn test_void_order_payload_dto_deserialization() {
        let json_data = r#"{
            "orderId": "ORD-101",
            "tableId": "TABLE-5",
            "reason": "Customer cancellation",
            "actorId": "CASHIER_01",
            "actorRole": "Cashier",
            "managerPin": "1234"
        }"#;

        let dto: VoidOrderPayloadDto = serde_json::from_str(json_data).expect("Failed to deserialize");
        assert_eq!(dto.order_id, "ORD-101");
        assert_eq!(dto.table_id, "TABLE-5");
        assert_eq!(dto.reason, "Customer cancellation");
        assert_eq!(dto.actor_id, "CASHIER_01");
        assert_eq!(dto.actor_role, "Cashier");
        assert_eq!(dto.manager_pin.unwrap(), "1234");
    }

    /// Denetim kaydı istemciye giderken mühürlü bilgisi taşır; ham hash
    /// alanı DTO'da **yoktur** ve JSON'a sızmamalıdır.
    #[test]
    fn test_audit_log_dto_serialization() {
        let dto = AuditLogDto {
            id: "audit-001".to_string(),
            sequence: 42,
            timestamp: "2026-09-13T12:00:00Z".to_string(),
            actor_id: "SYS_ADMIN".to_string(),
            actor_role: "Owner".to_string(),
            category: crate::services::audit_service::category::SIPARIS_MASA.to_string(),
            action: "order:voided".to_string(),
            resource_id: "ORD-101".to_string(),
            payload: serde_json::json!({ "reason": "müşteri iptali" }),
            sealed: true,
        };

        let json_str = serde_json::to_string(&dto).expect("Failed to serialize");
        assert!(json_str.contains("\"actor_id\":\"SYS_ADMIN\""));
        assert!(json_str.contains("\"sequence\":42"));
        assert!(json_str.contains("\"action\":\"order:voided\""));
        assert!(json_str.contains("\"sealed\":true"));
        assert!(!json_str.contains("current_hash"));
        assert!(!json_str.contains("previous_hash"));
        assert!(!json_str.contains("hash\""));
    }

    #[test]
    fn test_cart_item_dto_deserialization_all_fields_present() {
        let json = r#"{
            "id": "item-1",
            "product": { "id": "prod-1", "name": "Tea" },
            "quantity": 2,
            "unitPrice": 1000,
            "taxRate": 10,
            "subtotal": 2000,
            "taxAmount": 200,
            "total": 2200,
            "modifiers": [{ "name": "Sugar" }],
            "note": "Extra hot",
            "discount": { "type": "PERCENTAGE", "value": 10 }
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize when all fields present");
        assert_eq!(item.id, "item-1");
        assert_eq!(item.quantity, 2);
        assert_eq!(item.unit_price, 1000);
        assert_eq!(item.tax_rate, Some(10));
        assert_eq!(item.subtotal, Some(2000));
        assert_eq!(item.tax_amount, Some(200));
        assert_eq!(item.total, Some(2200));
        assert_eq!(item.note, Some("Extra hot".to_string()));
    }

    #[test]
    fn test_cart_item_dto_deserialization_nullable_and_null_optional_fields() {
        let json = r#"{
            "id": "item-2",
            "product": { "id": "prod-1" },
            "quantity": 1,
            "unitPrice": 2000,
            "taxRate": null,
            "subtotal": null,
            "taxAmount": null,
            "total": null,
            "modifiers": null,
            "note": null,
            "discount": null
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize null optional fields");
        assert_eq!(item.id, "item-2");
        assert_eq!(item.unit_price, 2000);
        assert_eq!(item.tax_rate, None);
        assert_eq!(item.subtotal, None);
        assert_eq!(item.tax_amount, None);
        assert_eq!(item.total, None);
    }

    #[test]
    fn test_cart_item_dto_deserialization_missing_optional_fields() {
        let json = r#"{
            "id": "item-3",
            "product": { "id": "prod-2" },
            "quantity": 1,
            "unitPrice": 1500
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize missing optional fields");
        assert_eq!(item.id, "item-3");
        assert_eq!(item.unit_price, 1500);
        assert_eq!(item.tax_rate, None);
        assert_eq!(item.subtotal, None);
        assert_eq!(item.total, None);
    }

    #[test]
    fn test_cart_item_dto_deserialization_malformed_numeric_rejected() {
        let json = r#"{
            "id": "item-4",
            "product": { "id": "prod-3" },
            "quantity": "not-a-number",
            "unitPrice": 1000
        }"#;
        let result: Result<CartItemDto, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Must reject malformed quantity string");
    }

    #[test]
    fn test_cart_item_dto_deserialization_normal_pos_order() {
        let json = r#"{
            "id": "item-normal",
            "product": { "id": "prd-001", "name": "Turk Kahvesi" },
            "quantity": 1,
            "unitPrice": 2000,
            "taxRate": 8,
            "subtotal": 2000,
            "taxAmount": 160,
            "total": 2160
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize standard normal POS item");
        assert_eq!(item.id, "item-normal");
        assert_eq!(item.unit_price, 2000);
        assert_eq!(item.total, Some(2160));
    }
}#[tauri::command]
pub async fn get_active_shift(cashier_id: String, pool: tauri::State<'_, DbPool>) -> Result<Option<ShiftDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query("SELECT id, tenant_id, cashier_id, status, opened_at, expected_amount_cents FROM shifts WHERE cashier_id = ? AND status = 'OPEN'")
        .bind(&cashier_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = row {
        Ok(Some(ShiftDto {
            id: r.try_get("id").unwrap_or_default(),
            tenant_id: r.try_get("tenant_id").unwrap_or_default(),
            cashier_id: r.try_get("cashier_id").unwrap_or_default(),
            status: r.try_get("status").unwrap_or_default(),
            opened_at: r.try_get("opened_at").unwrap_or_default(),
            closed_at: None,
            expected_amount_cents: r.try_get("expected_amount_cents").unwrap_or(0),
            actual_amount_cents: None,
            difference_cents: None
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_order_items(
    table_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CartItemDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT id FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1")
        .bind(&table_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let order_id: String = match row {
        Some(r) => r.try_get("id").unwrap_or_default(),
        None => return Ok(vec![]),
    };

    let items = sqlx::query("
        SELECT oi.*, p.name as product_name, p.category_id as product_category_id, p.barcode as product_barcode
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    ")
    .bind(&order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in items {
        let modifiers_str: Option<String> = row.try_get("modifiers").ok();
        let modifiers_val: Option<serde_json::Value> = modifiers_str.and_then(|m| serde_json::from_str(&m).ok());

        let product_json = serde_json::json!({
            "id": row.try_get::<String, _>("product_id").unwrap_or_default(),
            "name": row.try_get::<String, _>("product_name").unwrap_or_default(),
            "category": row.try_get::<String, _>("product_category_id").unwrap_or_default(),
            "categoryId": row.try_get::<String, _>("product_category_id").unwrap_or_default(),
            "price": row.try_get::<i32, _>("unit_price_cents").unwrap_or(0) as i64,
            "taxRate": row.try_get::<f64, _>("tax_rate").unwrap_or(10.0),
            "barcode": row.try_get::<Option<String>, _>("product_barcode").unwrap_or_default(),
            "inStock": true,
        });

        result.push(CartItemDto {
            id: row.try_get("id").unwrap_or_default(),
            product: product_json,
            quantity: row.try_get::<i32, _>("quantity").unwrap_or(0) as i64,
            unit_price: row.try_get::<i32, _>("unit_price_cents").unwrap_or(0) as i64,
            tax_rate: Some(row.try_get::<f64, _>("tax_rate").unwrap_or(0.0) as i64),
            subtotal: Some(row.try_get::<i32, _>("subtotal_cents").unwrap_or(0) as i64),
            tax_amount: Some(row.try_get::<i32, _>("tax_amount_cents").unwrap_or(0) as i64),
            total: Some(row.try_get::<i32, _>("total_cents").unwrap_or(0) as i64),
            modifiers: modifiers_val,
            note: row.try_get("notes").ok(),
            discount: None,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn merge_tables(
    source_id: String,
    target_id: String,
    actor_id: String,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let _lock = state.payment_mutex.lock().await;
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    // Move all open orders from source to target
    sqlx::query("UPDATE orders SET table_id = ? WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')")
        .bind(&target_id).bind(&source_id)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    
    // Move all order_items if needed (they reference order_id, so no change needed)
    
    // Free the source table
    sqlx::query("UPDATE tables SET status = 'AVAILABLE', current_total = 0, waiter_id = NULL, opened_at = NULL WHERE id = ?")
        .bind(&source_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    
    // Recalculate target table total
    sqlx::query("UPDATE tables SET current_total = (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE table_id = ? AND status IN ('OPEN','IN_PROGRESS')) WHERE id = ?")
        .bind(&target_id).bind(&target_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;

    let now_iso = chrono::Utc::now().to_rfc3339();
    let tenant_id = table_tenant(&mut tx, &target_id).await;
    let (_, actor_role) = audit_actor(None, actor_role);
    let payload = serde_json::json!({"sourceId": source_id, "targetId": target_id});
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "table:merged",
        target_id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LiveOrderDto {
    pub id: String,
    pub table_name: String,
    pub status: String,
    pub total_cents: i64,
    pub created_at: String,
    pub item_count: i64,
}

#[tauri::command]
pub async fn get_live_orders(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<LiveOrderDto>, String> {
    crate::rbac::require_reporting(&actor_role)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("
        SELECT o.id, t.name as table_name, o.status, o.total_cents, o.created_at,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        JOIN tables t ON o.table_id = t.id
        WHERE o.status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY o.created_at ASC
    ").fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    
    let orders = rows.into_iter().map(|r| LiveOrderDto {
        id: r.try_get("id").unwrap_or_default(),
        table_name: r.try_get("table_name").unwrap_or_default(),
        status: r.try_get("status").unwrap_or_default(),
        total_cents: r.try_get("total_cents").unwrap_or(0),
        created_at: r.try_get("created_at").unwrap_or_default(),
        item_count: r.try_get("item_count").unwrap_or(0),
    }).collect();
    Ok(orders)
}

#[tauri::command]
pub async fn get_open_shifts(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    crate::rbac::require_any(&actor_role, &[crate::rbac::Role::Owner, crate::rbac::Role::Manager, crate::rbac::Role::Cashier])?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("
        SELECT s.id, s.cashier_id, u.name as cashier_name, s.opened_at, s.expected_amount_cents
        FROM shifts s LEFT JOIN users u ON s.cashier_id = u.id
        WHERE s.status = 'OPEN' ORDER BY s.opened_at ASC
    ").fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let shifts: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
        "id": r.try_get::<String,_>("id").unwrap_or_default(),
        "cashierId": r.try_get::<String,_>("cashier_id").unwrap_or_default(),
        "cashierName": r.try_get::<String,_>("cashier_name").unwrap_or_default(),
        "openedAt": r.try_get::<String,_>("opened_at").unwrap_or_default(),
        "openingBalance": r.try_get::<i32,_>("expected_amount_cents").unwrap_or(0),
    })).collect();
    Ok(shifts)
}

#[tauri::command]
pub async fn get_shift_history(
    cashier_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ShiftDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let cid = cashier_id.unwrap_or_default();
    let rows = if cid.is_empty() || cid == "ALL" {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents 
             FROM shifts ORDER BY opened_at DESC LIMIT 50"
        )
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents, actual_amount_cents, difference_cents 
             FROM shifts WHERE cashier_id = ? ORDER BY opened_at DESC LIMIT 50"
        )
        .bind(&cid)
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
    };

    let shifts = rows.into_iter().map(|r| ShiftDto {
        id: r.try_get("id").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
        cashier_id: r.try_get("cashier_id").unwrap_or_default(),
        status: r.try_get("status").unwrap_or_default(),
        opened_at: r.try_get("opened_at").unwrap_or_default(),
        closed_at: r.try_get("closed_at").ok().flatten(),
        expected_amount_cents: r.try_get("expected_amount_cents").unwrap_or(0),
        actual_amount_cents: r.try_get("actual_amount_cents").ok().flatten(),
        difference_cents: r.try_get("difference_cents").ok().flatten(),
    }).collect();
    Ok(shifts)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseDayResultDto {
    pub success: bool,
    pub message: String,
    pub closed_shifts_count: i64,
    pub total_revenue_cents: i64,
    pub total_orders: i64,
    pub closed_at: String,
}

#[tauri::command]
pub async fn close_day(
    actor_role: Option<String>,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    #[allow(non_snake_case)]
    tenantId: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CloseDayResultDto, String> {
    let effective_tenant = tenant_id.or(tenantId).unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let now_str = chrono::Utc::now().to_rfc3339();

    // 1. Yalnızca bu işletmeye ait açık vardiyaları kapat ve dürüst mutabakat farkını mühürle
    let open_shifts = sqlx::query("SELECT id, expected_amount_cents, actual_amount_cents FROM shifts WHERE status = 'OPEN' AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
        .bind(&effective_tenant)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let closed_shifts_count = open_shifts.len() as i64;
    for shift in open_shifts {
        let sid: String = shift.try_get("id").unwrap_or_default();
        let expected: i32 = shift.try_get("expected_amount_cents").unwrap_or(0);
        let actual_opt: Option<i32> = shift.try_get("actual_amount_cents").ok();

        let (actual, diff) = if let Some(act) = actual_opt {
            (act, act - expected)
        } else {
            (expected, 0)
        };

        sqlx::query("UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now'), actual_amount_cents = ?, difference_cents = ? WHERE id = ? AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT')")
            .bind(actual)
            .bind(diff)
            .bind(&sid)
            .bind(&effective_tenant)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 2. Bu işletmeye ait günlük ciroyu çek
    let row = sqlx::query("SELECT COALESCE(sum(total_cents), 0) as total, COUNT(*) as count FROM orders WHERE status IN ('PAID', 'CLOSED') AND (tenant_id = ? OR tenant_id = 'DEFAULT_TENANT') AND created_at >= date('now', 'start of day')")
        .bind(&effective_tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let total_revenue_cents: i64 = row.try_get("total").unwrap_or(0);
    let total_orders: i64 = row.try_get("count").unwrap_or(0);

    // 3. Denetim defteri kaydını ekle.
    //
    // Bu kayıt artık `?` ile zorunlu: gün sonu kapanışı deftere girmeden
    // commit edilmez. Önceden hata sessizce yutuluyordu.
    let (user_id, role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "tenantId": &effective_tenant,
        "closedShiftsCount": closed_shifts_count,
        "totalRevenueCents": total_revenue_cents,
        "totalOrders": total_orders,
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        effective_tenant,
        user_id,
        role,
        crate::services::audit_service::category::FINANS,
        "day:closed",
        "DAILY_CLOSING".to_string(),
        payload,
        now_str.clone(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(CloseDayResultDto {
        success: true,
        message: format!("Gün sonu başarıyla kapatıldı. {} adet açık vardiya sonlandırıldı.", closed_shifts_count),
        closed_shifts_count,
        total_revenue_cents,
        total_orders,
        closed_at: now_str,
    })
}

#[tauri::command]
pub async fn try_lock_table(
    table_id: String,
    waiter_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let mut locks = state.table_locks.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    
    if let Some((locked_by, locked_at)) = locks.get(&table_id) {
        if locked_by != &waiter_id && (now - locked_at) < 1800000 {
            return Ok(false);
        }
    }
    
    locks.insert(table_id, (waiter_id, now));
    Ok(true)
}

#[tauri::command]
pub async fn unlock_table(
    table_id: String,
    waiter_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut locks = state.table_locks.lock().await;
    if let Some((locked_by, _)) = locks.get(&table_id) {
        if locked_by == &waiter_id {
            locks.remove(&table_id);
        }
    }
    Ok(())
}
