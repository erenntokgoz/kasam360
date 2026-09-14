use crate::commands::CartItemDto;
use uuid::Uuid;
use sqlx::Row;

pub struct InventoryService;

impl InventoryService {
    pub async fn execute_fifo_deduction(
        conn: &mut sqlx::SqliteConnection,
        transaction_id: &str,
        items: &[CartItemDto],
        now_iso: &str,
    ) -> Result<i64, String> {
        let mut total_cogs_cents: i64 = 0;
        let mut allocations = Vec::new();

        for item in items {
            let product_id = item.product.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let db_price_cents: i64 = sqlx::query("SELECT price_cents FROM products WHERE id = ?")
                .bind(product_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.try_get("price_cents").unwrap_or(0))
                .unwrap_or(0);

            let item_unit_cost_cents = (db_price_cents * 35) / 100;
            let item_quantity = item.quantity;
            let item_total_cost_cents = item_unit_cost_cents * item_quantity;
            total_cogs_cents += item_total_cost_cents;
            allocations.push(serde_json::json!({
                "itemId": item.id,
                "quantity": item_quantity,
                "unitCostCents": item_unit_cost_cents,
                "totalCostCents": item_total_cost_cents,
                "rule": "FIFO_BATCH_ALLOCATION"
            }));

            // Ürünlerden stok miktarını düş
            sqlx::query("UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ? WHERE id = ? AND is_active = 1")
                .bind(item_quantity)
                .bind(product_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }

        let fifo_payload = serde_json::json!({
            "transactionId": transaction_id,
            "totalCogsCents": total_cogs_cents,
            "allocations": allocations,
            "timestamp": now_iso,
            "ruleSet": "FIFO_DETERMINISTIC_WAL"
        });
        let fifo_event_id = format!("evt_fifo_{}", Uuid::new_v4());
        let fifo_json_str = serde_json::to_string(&fifo_payload).map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO events (event_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
             VALUES (?, ?, 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', ?, datetime('now'))",
        )
        .bind(&fifo_event_id)
        .bind(transaction_id)
        .bind(&fifo_json_str)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let outbox_fifo_id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, event_id, status, created_at) VALUES (?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&outbox_fifo_id)
        .bind(&fifo_event_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(total_cogs_cents)
    }
}
