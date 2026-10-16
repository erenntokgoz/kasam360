//! Masa arası sipariş kalemi aktarımı (split / transfer) komutu.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use sqlx::Row;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn transfer_order_item(
    item_id: String,
    target_table_id: String,
    quantity: i64,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
            crate::rbac::Role::Waiter,
        ],
    )?;

    if quantity <= 0 {
        return Err("INVALID_QUANTITY: Aktarılacak miktar 1 veya daha fazla olmalıdır.".into());
    }

    let _lock = state.payment_mutex.lock().await;
    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Hedef masayı doğrula
    let target_table = sqlx::query("SELECT id FROM tables WHERE id = ? AND tenant_id = ?")
        .bind(&target_table_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    if target_table.is_none() {
        return Err("TARGET_NOT_FOUND: Hedef masa bulunamadı.".into());
    }

    // Aktarılacak kalemi oku
    let item_row = sqlx::query(
        "SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.paid_quantity, \
                oi.is_comp, oi.course_number, oi.unit_price_cents, oi.tax_rate_bp, \
                oi.modifiers, oi.notes, oi.station, oi.status, oi.waiter_id, \
                o.table_id AS source_table_id \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id \
         WHERE oi.id = ? AND oi.tenant_id = ?",
    )
    .bind(&item_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let row = item_row.ok_or_else(|| "ITEM_NOT_FOUND: Kalem bulunamadı.".to_string())?;
    let src_order_id: String = row.try_get("order_id").map_err(|e| e.to_string())?;
    let src_table_id: String = row.try_get("source_table_id").map_err(|e| e.to_string())?;
    let current_qty: i64 = row.try_get("quantity").map_err(|e| e.to_string())?;
    let paid_qty: i64 = row.try_get("paid_quantity").unwrap_or(0);
    let available_qty = current_qty - paid_qty;

    if quantity > available_qty {
        return Err(format!(
            "INVALID_QUANTITY: Yalnızca ödenmemiş miktar ({}) aktarılabilir.",
            available_qty
        ));
    }

    let product_id: String = row.try_get("product_id").map_err(|e| e.to_string())?;
    let unit_price_cents: i64 = row.try_get("unit_price_cents").map_err(|e| e.to_string())?;
    let tax_rate_bp: i64 = row.try_get("tax_rate_bp").map_err(|e| e.to_string())?;
    let is_comp: i64 = row.try_get("is_comp").unwrap_or(0);
    let course_number: i64 = row.try_get("course_number").unwrap_or(1);
    let modifiers: Option<String> = row.try_get("modifiers").ok();
    let notes: Option<String> = row.try_get("notes").ok();
    let station: Option<String> = row.try_get("station").ok();
    let status: String = row.try_get("status").unwrap_or_else(|_| "Pending".into());
    let waiter_id: Option<String> = row.try_get("waiter_id").ok();

    // Hedef masada açık sipariş bul veya oluştur
    let target_order: Option<String> = sqlx::query_scalar(
        "SELECT id FROM orders \
         WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS') \
         ORDER BY created_at ASC LIMIT 1",
    )
    .bind(&target_table_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let target_order_id = match target_order {
        Some(oid) => oid,
        None => {
            let new_order_id = crate::id_generator::generate_id("ord");
            sqlx::query(
                "INSERT INTO orders (id, tenant_id, table_id, status, guest_count, created_at, updated_at) \
                 VALUES (?, ?, ?, 'OPEN', 1, datetime('now'), datetime('now'))",
            )
            .bind(&new_order_id)
            .bind(&tenant_id)
            .bind(&target_table_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE tables SET status = 'OCCUPIED', opened_at = COALESCE(opened_at, datetime('now')) \
                 WHERE id = ? AND tenant_id = ?",
            )
            .bind(&target_table_id)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

            new_order_id
        }
    };

    if quantity == current_qty {
        // Kalemin tamamını taşı
        sqlx::query("UPDATE order_items SET order_id = ? WHERE id = ? AND tenant_id = ?")
            .bind(&target_order_id)
            .bind(&item_id)
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        // Kalemi böl
        let rem_qty = current_qty - quantity;
        let rem_subtotal = rem_qty * unit_price_cents;
        let rem_tax = (rem_subtotal * tax_rate_bp) / 10_000;
        let rem_total = rem_subtotal + rem_tax;

        sqlx::query(
            "UPDATE order_items \
             SET quantity = ?, subtotal_cents = ?, tax_amount_cents = ?, total_cents = ? \
             WHERE id = ? AND tenant_id = ?",
        )
        .bind(rem_qty)
        .bind(rem_subtotal)
        .bind(rem_tax)
        .bind(rem_total)
        .bind(&item_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let trans_subtotal = quantity * unit_price_cents;
        let trans_tax = (trans_subtotal * tax_rate_bp) / 10_000;
        let trans_total = trans_subtotal + trans_tax;
        let new_item_id = crate::id_generator::generate_id("itm");

        sqlx::query(
            "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, paid_quantity, \
                is_comp, course_number, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, \
                total_cents, modifiers, notes, station, status, waiter_id) \
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&new_item_id)
        .bind(&tenant_id)
        .bind(&target_order_id)
        .bind(&product_id)
        .bind(quantity)
        .bind(is_comp)
        .bind(course_number)
        .bind(unit_price_cents)
        .bind(tax_rate_bp)
        .bind(trans_subtotal)
        .bind(trans_tax)
        .bind(trans_total)
        .bind(&modifiers)
        .bind(&notes)
        .bind(&station)
        .bind(&status)
        .bind(&waiter_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Sipariş toplamlarını güncelle
    for oid in [&src_order_id, &target_order_id] {
        sqlx::query(
            "UPDATE orders \
             SET total_cents = (SELECT COALESCE(SUM(total_cents), 0) FROM order_items WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'), \
                 updated_at = datetime('now') \
             WHERE id = ? AND tenant_id = ?",
        )
        .bind(oid)
        .bind(&tenant_id)
        .bind(oid)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Masa toplamlarını güncelle
    for tid in [&src_table_id, &target_table_id] {
        sqlx::query(
            "UPDATE tables \
             SET current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')) \
             WHERE id = ? AND tenant_id = ?",
        )
        .bind(tid)
        .bind(&tenant_id)
        .bind(tid)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let payload = serde_json::json!({
        "itemId": item_id,
        "fromTableId": src_table_id,
        "toTableId": target_table_id,
        "quantity": quantity,
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "order_item:transferred",
        item_id,
        payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
