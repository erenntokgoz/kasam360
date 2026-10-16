//! POS sipariş gönderimi ve seçenek dondurma komutu.
//!
//! Neden ayrı modül: pos_commands.rs 500 satır tavanını aştığı için
//! sipariş oluşturma ve mutfak/outbox yazımı bu alt modüle ayrıldı.

use crate::commands::command_helpers::audit_actor;
use crate::commands::payment_commands::CartItemDto;
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SubmitOrderPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub items: Vec<CartItemDto>,
    pub notes: Option<String>,
}

/// Seçenek snapshot'ını **veritabanı fiyatlarıyla** yeniden yazar.
pub(crate) async fn authoritative_modifier_snapshot(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    modifiers: Option<&serde_json::Value>,
) -> Result<Option<String>, String> {
    let arr = match modifiers.and_then(|m| m.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return Ok(None),
    };

    let mut snapshot: Vec<serde_json::Value> = Vec::with_capacity(arr.len());
    for entry in arr {
        let option_id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "MALICIOUS_INPUT: Seçenek kimliği eksik.".to_string())?;

        let row: Option<(String, String, i64)> = sqlx::query_as(
            "SELECT mo.id, mo.name, mo.price_cents FROM modifier_options mo \
             JOIN modifier_groups mg ON mg.id = mo.group_id \
             WHERE mo.id = ? AND mg.tenant_id = ?",
        )
        .bind(option_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (id, name, price_cents) = row.ok_or_else(|| {
            "MALICIOUS_INPUT: Seçenek bu işletmeye ait değil veya silinmiş.".to_string()
        })?;

        snapshot.push(serde_json::json!({
            "id": id,
            "name": name,
            "priceCents": price_cents,
        }));
    }

    Ok(Some(
        serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
    ))
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
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
            crate::rbac::Role::Waiter,
        ],
    )?;

    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // 1. Calculate authoritative totals and prepared items
    struct PreparedOrderItem {
        id: String,
        product_id: String,
        quantity: i64,
        unit_price_cents: i64,
        tax_rate_bp: i64,
        subtotal_cents: i64,
        tax_amount_cents: i64,
        total_cents: i64,
        modifiers_json: Option<String>,
        notes: Option<String>,
        station: Option<String>,
        course_number: i64,
    }

    let mut prepared_items: Vec<PreparedOrderItem> = Vec::with_capacity(payload.items.len());
    let mut total_cents: i64 = 0;

    for item in &payload.items {
        let product_id = item
            .product
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Fiyatlandırma motorundan dinamik/efektif fiyatı ve 86'd durumunu çöz
        let effective_pricing = crate::services::inventory360::pricing::effective_price(
            &mut tx, &tenant_id, product_id, None,
        )
        .await
        .map_err(|e| format!("Product pricing failed: {}", e))?;

        if effective_pricing.is_86d {
            return Err(
                "PRODUCT_86D: Ürün geçici olarak tükendi (86'd) ve siparişe eklenemez".to_string(),
            );
        }

        let row = sqlx::query(
            "SELECT p.tax_rate_bp, p.is_active, c.default_station \
             FROM products p \
             LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id \
             WHERE p.id = ? AND p.tenant_id = ?",
        )
        .bind(product_id)
        .bind(&tenant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Product not found: {}", e))?;

        let is_active: bool = row.try_get("is_active").unwrap_or(true);
        if !is_active {
            return Err(
                "PRODUCT_86D: Ürün geçici olarak tükendi (86'd) ve siparişe eklenemez".to_string(),
            );
        }

        let db_tax_rate_bp: i64 = row.try_get("tax_rate_bp").unwrap_or(1000);
        let default_station: Option<String> = row.try_get("default_station").ok();
        let price_cents: i64 = effective_pricing.final_price_cents;
        let qty = item.quantity;

        let item_unit_price = crate::services::modifier_service::resolve_unit_price(
            &mut tx,
            &tenant_id,
            (price_cents, db_tax_rate_bp),
            item.modifiers.as_ref(),
            None,
        )
        .await?;
        let item_subtotal = item_unit_price * qty;
        let item_tax = (item_subtotal * db_tax_rate_bp) / 10_000;
        let item_total = item_subtotal + item_tax;
        total_cents += item_total;

        let modifiers_json =
            authoritative_modifier_snapshot(&mut tx, &tenant_id, item.modifiers.as_ref()).await?;

        let item_notes = item.note.clone().or_else(|| payload.notes.clone());
        let item_course = item.course_number.unwrap_or(1);

        prepared_items.push(PreparedOrderItem {
            id: crate::id_generator::generate_id("itm"),
            product_id: product_id.to_string(),
            quantity: qty,
            unit_price_cents: item_unit_price,
            tax_rate_bp: db_tax_rate_bp,
            subtotal_cents: item_subtotal,
            tax_amount_cents: item_tax,
            total_cents: item_total,
            modifiers_json,
            notes: item_notes,
            station: default_station,
            course_number: item_course,
        });
    }

    // 2. Check if open order already exists for this table
    let existing_order: Option<(String, i64)> = sqlx::query_as(
        "SELECT id, total_cents FROM orders WHERE table_id=? AND tenant_id=? AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let effective_order_id = match existing_order {
        Some((order_id, existing_total)) => {
            let new_total = existing_total + total_cents;
            sqlx::query("UPDATE orders SET total_cents = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
                .bind(new_total)
                .bind(&order_id)
                .bind(&tenant_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            order_id
        }
        None => {
            let ord_id = if payload.order_id.trim().is_empty() {
                crate::id_generator::generate_id("ord")
            } else {
                payload.order_id.clone()
            };
            sqlx::query(
                "INSERT INTO orders (id, table_id, status, total_cents, created_at, updated_at, tenant_id) VALUES (?, ?, 'OPEN', ?, datetime('now'), datetime('now'), ?)"
            )
            .bind(&ord_id)
            .bind(&payload.table_id)
            .bind(total_cents)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            ord_id
        }
    };

    // 3. Insert items
    for item in prepared_items {
        sqlx::query(
            "INSERT INTO order_items (id, order_id, product_id, quantity, paid_quantity, is_comp, course_number, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, modifiers, notes, station, status, waiter_id, tenant_id)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)"
        )
        .bind(&item.id)
        .bind(&effective_order_id)
        .bind(&item.product_id)
        .bind(item.quantity)
        .bind(item.course_number)
        .bind(item.unit_price_cents)
        .bind(item.tax_rate_bp)
        .bind(item.subtotal_cents)
        .bind(item.tax_amount_cents)
        .bind(item.total_cents)
        .bind(&item.modifiers_json)
        .bind(&item.notes)
        .bind(&item.station)
        .bind(&actor_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // 4. Update table status and total
    let current_table_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')"
    )
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE tables SET status = 'OCCUPIED', current_total = ?, opened_at = COALESCE(opened_at, datetime('now')), waiter_id = COALESCE(waiter_id, ?) WHERE id = ? AND tenant_id = ?",
    )
    .bind(current_table_total)
    .bind(&actor_id)
    .bind(&payload.table_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // 5. Append event & outbox
    let event_id = crate::id_generator::generate_id("evt");
    let event_payload = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "items": payload.items,
        "notes": payload.notes,
        "totalCents": total_cents
    });

    sqlx::query("INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'ORDER', 'ORDER_SUBMITTED', ?, datetime('now'))")
        .bind(&event_id)
        .bind(&tenant_id)
        .bind(&payload.order_id)
        .bind(event_payload.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let outbox_id = crate::id_generator::generate_id("obx");
    sqlx::query("INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))")
        .bind(&outbox_id)
        .bind(&tenant_id)
        .bind(&event_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

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
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}
