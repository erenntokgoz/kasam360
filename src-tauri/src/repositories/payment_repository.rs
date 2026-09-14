use crate::commands::{CartItemDto, PaymentPayloadDto};
use sqlx::Row;
use uuid::Uuid;

pub struct PaymentRepository;

impl PaymentRepository {
    pub async fn check_idempotency(
        conn: &mut sqlx::SqliteConnection,
        transaction_id: &str,
    ) -> Result<bool, String> {
        let existing: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
            "SELECT id FROM audit_ledger WHERE resource_id = ? LIMIT 1",
        )
        .bind(transaction_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(existing.is_some())
    }

    pub async fn calculate_server_truth_total(
        conn: &mut sqlx::SqliteConnection,
        items: &[CartItemDto]
    ) -> Result<i64, String> {
        let mut total_cents: i64 = 0;
        for item in items {
            let product_id = item.product.get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing product.id in cart item".to_string())?;

            let row = sqlx::query("SELECT price_cents, tax_rate FROM products WHERE id = ?")
                .bind(product_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            let (db_price_cents, db_tax_rate): (i64, f64) = match row {
                Some(r) => (r.try_get("price_cents").unwrap_or(0), r.try_get("tax_rate").unwrap_or(0.0)),
                None => return Err(format!("Product not found in database: {}", product_id)),
            };

            let mut item_unit_price = db_price_cents;
            if let Some(mods) = &item.modifiers {
                if let Some(arr) = mods.as_array() {
                    for mod_opt in arr {
                        if let Some(pc) = mod_opt.get("priceCents").and_then(|v| v.as_i64()) {
                            item_unit_price += pc;
                        }
                    }
                }
            }

            let quantity = item.quantity;
            let subtotal_cents = item_unit_price * quantity;
            let tax_rate_int = db_tax_rate.round() as i64;
            let tax_amount_cents = (subtotal_cents * tax_rate_int) / 100;
            let item_total_cents = subtotal_cents + tax_amount_cents;
            total_cents += item_total_cents;
        }
        Ok(total_cents)
    }

    pub async fn insert_sale_event(
        conn: &mut sqlx::SqliteConnection,
        payload: &PaymentPayloadDto,
    ) -> Result<(), String> {
        let sale_event_id = format!("evt_sale_{}", Uuid::new_v4());
        let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO events (event_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
             VALUES (?, ?, 'SALE', 'SALE_SETTLED', ?, datetime('now'))",
        )
        .bind(&sale_event_id)
        .bind(&payload.transaction_id)
        .bind(&payload_json)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let outbox_sale_id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, event_id, status, created_at) VALUES (?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&outbox_sale_id)
        .bind(&sale_event_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn close_order_if_applicable(
        conn: &mut sqlx::SqliteConnection,
        order_id: Option<&str>,
    ) -> Result<(), String> {
        if let Some(o_id) = order_id {
            let order_row = sqlx::query("SELECT table_id FROM orders WHERE id = ? AND status = 'OPEN'")
                .bind(o_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(row) = order_row {
                let table_id: String = row.try_get("table_id").unwrap_or_default();
                
                sqlx::query("UPDATE orders SET status = 'PAID' WHERE id = ?")
                    .bind(o_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                sqlx::query("UPDATE tables SET status = 'AVAILABLE' WHERE id = ? AND status = 'RESERVED'")
                    .bind(&table_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
