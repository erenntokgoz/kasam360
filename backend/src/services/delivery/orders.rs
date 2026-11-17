//! Paket siparişi oluşturma ve iptal.
//!
//! Kalemler `execute_submit_order` hattından geçer: fiyat, KDV ve stok düşümü masa
//! siparişiyle aynı kuraldadır, istemcinin gönderdiği tutar kullanılmaz. Teslimat ücreti
//! görünmez bir hizmet ürününün satırı olarak adisyona eklenir; böylece tahsilat, fiş ve
//! KDV ayrımı ek bir kural gerektirmez.

use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use super::{
    amount_gate, find_delivery, id_is_valid, optional_text, text_error, DeliveryRow,
    FEE_PRODUCT_SKU, PAYMENT_METHODS, TABLE_ID_PREFIX,
};
use crate::commands::payment_commands::CartItemDto;
use crate::commands::pos_commands::{execute_submit_order, SubmitOrderPayloadDto};
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

/// Hizmet ürününün KDV oranı (binde); teslimat ücreti %20 KDV'ye tabidir.
const FEE_TAX_RATE_BP: i64 = 2000;
const NOTE_MAX: usize = 500;
/// Bu turda yalnız telefon ve tezgâh kaynağı yazılır; platform bağlantısı sonraki iştir.
const WRITABLE_SOURCES: [&str; 2] = ["PHONE", "COUNTER"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDelivery {
    pub customer_id: String,
    pub address_id: String,
    pub items: Vec<CartItemDto>,
    #[serde(default)]
    pub fee_cents: i64,
    pub payment_method: String,
    #[serde(default)]
    pub note: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDelivery {
    pub delivery_id: String,
    pub order_id: String,
    /// Mutfak fişine gidecek kalemler; teslimat ücreti satırı dahil değildir.
    pub item_ids: Vec<String>,
    pub total_cents: i64,
}

/// Teslimat ücreti ürününü bulur ya da ilk kullanımda açar.
///
/// Neden pasif ve kategorisiz: satış menüsü kategorili ve etkin ürünleri listeler, bu ürün
/// menüde görünmez ama adisyon satırı olarak geçerlidir.
async fn fee_product_id(conn: &mut SqliteConnection, tenant_id: &str) -> Result<String, String> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM products WHERE tenant_id = ? AND sku = ? LIMIT 1")
            .bind(tenant_id)
            .bind(FEE_PRODUCT_SKU)
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = crate::id_generator::generate_id("prd");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, sku, name, price_cents, tax_rate_bp, is_active, is_raw)
         VALUES (?, ?, ?, 'Teslimat ücreti', 0, ?, 0, 0)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(FEE_PRODUCT_SKU)
    .bind(FEE_TAX_RATE_BP)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(id)
}

/// Ücret satırını adisyona yazar ve toplamları günceller. Satır `Served` doğar: mutfakta
/// hazırlanacak bir şey yoktur, mutfak ekranı ve "masaya götür" listesi onu beklemez.
async fn add_fee_line(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    table_id: &str,
    fee_cents: i64,
    actor_id: &str,
) -> Result<(), String> {
    let product_id = fee_product_id(conn, tenant_id).await?;
    let (subtotal, tax) = crate::domain::money::split_inclusive_tax(fee_cents, FEE_TAX_RATE_BP);
    sqlx::query(
        "INSERT INTO order_items (id, order_id, product_id, quantity, paid_quantity, is_comp,
                course_number, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents,
                total_cents, status, waiter_id, tenant_id)
         VALUES (?, ?, ?, 1, 0, 0, 1, ?, ?, ?, ?, ?, 'Served', ?, ?)",
    )
    .bind(crate::id_generator::generate_id("itm"))
    .bind(order_id)
    .bind(&product_id)
    .bind(fee_cents)
    .bind(FEE_TAX_RATE_BP)
    .bind(subtotal)
    .bind(tax)
    .bind(fee_cents)
    .bind(actor_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE orders SET total_cents = total_cents + ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(fee_cents)
    .bind(order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE tables SET current_total = current_total + ? WHERE id = ? AND tenant_id = ?",
    )
    .bind(fee_cents)
    .bind(table_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Paket siparişini oluşturur: müşteri ve adres doğrulanır, adisyon açılır, teslimat kaydı yazılır.
pub async fn create(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: &NewDelivery,
) -> Result<CreatedDelivery, String> {
    super::require_enabled(conn, tenant_id).await?;
    if input.items.is_empty() {
        return Err("INVALID_ARGUMENT: paket siparişinde en az bir ürün olmalı".to_string());
    }
    amount_gate(input.fee_cents, "teslimat ücreti")?;
    let method = input.payment_method.trim().to_uppercase();
    if !PAYMENT_METHODS.contains(&method.as_str()) {
        return Err("INVALID_ARGUMENT: ödeme şekli geçersiz".to_string());
    }
    let source = input
        .source
        .as_deref()
        .map(|value| value.trim().to_uppercase())
        .unwrap_or_else(|| "PHONE".to_string());
    if !WRITABLE_SOURCES.contains(&source.as_str()) {
        return Err("INVALID_ARGUMENT: platform siparişleri henüz alınmıyor".to_string());
    }
    let note = optional_text(&input.note, "not", NOTE_MAX)?;

    // Müşteri ve adres bu kiracıya ait ve etkin olmalı; başka işletmenin kaydı seçilemez.
    let customer = super::customers::get(conn, tenant_id, input.customer_id.trim()).await?;
    let address = customer
        .addresses
        .iter()
        .find(|candidate| candidate.id == input.address_id.trim())
        .ok_or_else(|| "NOT_FOUND: adres bu müşteriye ait değil".to_string())?;

    let delivery_id = crate::id_generator::generate_id("dlv");
    let table_id = format!(
        "{TABLE_ID_PREFIX}{}",
        &crate::id_generator::generate_id("t")[2..]
    );
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES (?, ?, ?, 'AVAILABLE', 0)",
    )
    .bind(&table_id)
    .bind(tenant_id)
    .bind(format!("Paket - {}", customer.name))
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    let submit = SubmitOrderPayloadDto {
        order_id: String::new(),
        table_id: table_id.clone(),
        items: input.items.clone(),
        notes: (!note.is_empty()).then(|| note.clone()),
        waiter_id: Some(actor_id.to_string()),
        guest_count: Some(1),
    };
    let (order_id, _items_total) =
        execute_submit_order(conn, tenant_id, &submit, Some(actor_id)).await?;
    if input.fee_cents > 0 {
        add_fee_line(
            conn,
            tenant_id,
            &order_id,
            &table_id,
            input.fee_cents,
            actor_id,
        )
        .await?;
    }
    let total_cents: i64 =
        sqlx::query_scalar("SELECT total_cents FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(&order_id)
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
    let item_ids: Vec<String> = sqlx::query_scalar(
        "SELECT oi.id FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ? AND oi.tenant_id = ? AND p.sku != ? ORDER BY oi.id",
    )
    .bind(&order_id)
    .bind(tenant_id)
    .bind(FEE_PRODUCT_SKU)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    sqlx::query(
        "INSERT INTO delivery_orders (id, tenant_id, order_id, customer_id, customer_name, phone,
                address_text, directions, source, status, fee_cents, payment_method, note,
                created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING', ?, ?, ?, ?, ?)",
    )
    .bind(&delivery_id)
    .bind(tenant_id)
    .bind(&order_id)
    .bind(&customer.id)
    .bind(&customer.name)
    .bind(&customer.phone)
    .bind(&address.address)
    .bind(&address.directions)
    .bind(&source)
    .bind(input.fee_cents)
    .bind(&method)
    .bind(&note)
    .bind(actor_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::SIPARIS_MASA,
        "delivery:created",
        delivery_id.clone(),
        serde_json::json!({
            "deliveryId": delivery_id,
            "orderId": order_id,
            "customerId": customer.id,
            "totalCents": total_cents,
            "feeCents": input.fee_cents,
            "paymentMethod": method,
            "source": source,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await?;

    Ok(CreatedDelivery {
        delivery_id,
        order_id,
        item_ids,
        total_cents,
    })
}

/// Teslim edilmemiş siparişi iptal eder. Onay jetonu çağıran komutta tüketilir.
///
/// Neden tahsil edilmiş siparişte yok: ödenmiş adisyon iptal edilmez, iade akışı vardır
/// (AGENTS.md §7). Teslim edilmiş ama kurye mutabakatı yapılmamış sipariş de iptal edilemez;
/// müşteri ürünü almıştır.
pub async fn cancel(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    delivery_id: &str,
    reason: &str,
) -> Result<DeliveryRow, String> {
    super::require_enabled(conn, tenant_id).await?;
    if !id_is_valid(delivery_id, "dlv") {
        return Err("INVALID_ARGUMENT: teslimat kimliği geçersiz".to_string());
    }
    let reason = super::required_text(reason, "iptal nedeni", NOTE_MAX)?;
    let delivery = find_delivery(conn, tenant_id, delivery_id).await?;
    if !matches!(delivery.status.as_str(), "PREPARING" | "READY" | "ON_ROUTE") {
        return Err(format!(
            "INVALID_TRANSITION: {} durumundaki sipariş iptal edilemez",
            delivery.status
        ));
    }
    let order_status: String =
        sqlx::query_scalar("SELECT status FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(&delivery.order_id)
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
    if !matches!(order_status.as_str(), "OPEN" | "IN_PROGRESS") {
        return Err("CANNOT_VOID_PAID_ORDER: tahsil edilmiş sipariş iptal edilemez".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let live_items: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM order_items WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'",
    )
    .bind(&delivery.order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    for item_id in &live_items {
        crate::services::order_stock::release_line(
            conn, tenant_id, item_id, &reason, actor_id, &now,
        )
        .await?;
    }
    sqlx::query(
        "UPDATE order_items SET status = 'CANCELLED' WHERE order_id = ? AND tenant_id = ?
           AND status != 'CANCELLED'",
    )
    .bind(&delivery.order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE orders SET status = 'VOID', updated_at = datetime('now'),
                notes = COALESCE(notes || ' | Void reason: ' || ?, 'Void reason: ' || ?)
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&reason)
    .bind(&reason)
    .bind(&delivery.order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE tables SET status = 'AVAILABLE', current_total = 0, opened_at = NULL, waiter_id = NULL
         WHERE tenant_id = ? AND id = (SELECT table_id FROM orders WHERE id = ? AND tenant_id = ?)",
    )
    .bind(tenant_id)
    .bind(&delivery.order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query(
        "UPDATE delivery_orders SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ?
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&now)
    .bind(&reason)
    .bind(delivery_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::SIPARIS_MASA,
        "delivery:cancelled",
        delivery_id.to_string(),
        serde_json::json!({
            "deliveryId": delivery_id,
            "orderId": delivery.order_id,
            "fromStatus": delivery.status,
            "reason": reason,
            "amountCents": delivery.total_cents,
        }),
        now,
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    find_delivery(conn, tenant_id, delivery_id).await
}
