use crate::commands::CartItemDto;
use uuid::Uuid;
use sqlx::Row;

pub struct InventoryService;

impl InventoryService {
    /// Deterministik gerçek FIFO parti/lot tüketimi ve COGS hesaplaması.
    /// Sahte %35 maliyet formülü tamamen kaldırılmış, `inventory_batches` üzerinden
    /// en eski partiden başlanarak maliyet düşülür.
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
            let mut remaining_demand = item.quantity as f64;

            // En eski partileri kronolojik sırayla çek (FIFO prensibi)
            let batch_rows = sqlx::query(
                "SELECT id, remaining_quantity, unit_cost_cents \
                 FROM inventory_batches \
                 WHERE product_id = ? AND remaining_quantity > 0 \
                 ORDER BY received_at ASC, id ASC"
            )
            .bind(product_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

            let mut item_cogs_cents: i64 = 0;
            let mut batch_allocations = Vec::new();

            for b in batch_rows {
                if remaining_demand <= 0.0 {
                    break;
                }
                let b_id: String = b.try_get("id").unwrap_or_default();
                let b_rem: f64 = b.try_get("remaining_quantity").unwrap_or(0.0);
                let b_cost: i64 = b.try_get("unit_cost_cents").unwrap_or(0);

                let take = remaining_demand.min(b_rem);
                let cost = (take * b_cost as f64).round() as i64;
                item_cogs_cents += cost;
                remaining_demand -= take;

                sqlx::query("UPDATE inventory_batches SET remaining_quantity = remaining_quantity - ? WHERE id = ?")
                    .bind(take)
                    .bind(&b_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                batch_allocations.push(serde_json::json!({
                    "batchId": b_id,
                    "quantity": take,
                    "unitCostCents": b_cost,
                    "totalCostCents": cost
                }));
            }

            // Eğer partilerden karşılanamayan bakiye varsa (henüz parti girilmemiş veya stok tükenmiş)
            if remaining_demand > 0.0 {
                batch_allocations.push(serde_json::json!({
                    "batchId": "UNTRACKED_DEFICIT",
                    "quantity": remaining_demand,
                    "unitCostCents": 0,
                    "totalCostCents": 0
                }));
            }

            total_cogs_cents += item_cogs_cents;
            allocations.push(serde_json::json!({
                "itemId": item.id,
                "productId": product_id,
                "quantity": item.quantity,
                "totalCostCents": item_cogs_cents,
                "batches": batch_allocations,
                "rule": "FIFO_DETERMINISTIC_BATCH"
            }));

            // Ürünlerden stok miktarını düş
            sqlx::query("UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ? WHERE id = ? AND is_active = 1")
                .bind(item.quantity)
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
