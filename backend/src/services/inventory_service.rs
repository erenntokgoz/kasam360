//! Deterministik gerçek FIFO parti/lot tüketimi ve COGS hesaplaması.
//!
//! Sahte %35 maliyet formülü tamamen kaldırılmıştır; maliyet
//! `inventory_batches` üzerinden en eski partiden başlanarak düşülür.

use crate::commands::CartItemDto;
use sqlx::Row;
use uuid::Uuid;

pub struct InventoryService;

/// FIFO sonucunu taşıyan sonuç.
///
/// `untracked_deficit` ayrı bir alandır, çünkü karşılanamayan miktar
/// `unit_cost_cents = 0` ile geçiştirilirse COGS eksik raporlanır ve P&L
/// "zarar yok" der. Bu sayı çağırana verilir; defterde ve radarda görünür.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FifoResult {
    pub total_cogs_cents: i64,
    /// Parti girişi yapılmamış olduğu için karşılanamayan toplam miktar.
    pub untracked_deficit: f64,
}

impl InventoryService {
    /// Deterministik gerçek FIFO parti/lot tüketimi ve COGS hesaplaması.
    ///
    /// `tenant_id` zorunludur: parti ve ürün satırları kimlikle değil,
    /// kimlik **ve** kiracı çiftiyle eşleşir. Aksi halde bir işletmenin
    /// satışı başka işletmenin partisini tüketir.
    pub async fn execute_fifo_deduction(
        conn: &mut sqlx::SqliteConnection,
        tenant_id: &str,
        transaction_id: &str,
        items: &[CartItemDto],
        now_iso: &str,
    ) -> Result<FifoResult, String> {
        let mut total_cogs_cents: i64 = 0;
        let mut total_deficit: f64 = 0.0;
        let mut allocations = Vec::new();

        for item in items {
            let product_id = item
                .product
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("STOCK: kalem {} için ürün kimliği eksik", item.id))?;
            let mut remaining_demand = item.quantity as f64;

            // En eski partileri kronolojik sırayla çek (FIFO prensibi)
            let batch_rows = sqlx::query(
                "SELECT id, remaining_quantity, unit_cost_cents \
                 FROM inventory_batches \
                 WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0 \
                 ORDER BY received_at ASC, id ASC",
            )
            .bind(tenant_id)
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
                // Kolon okumaları sessizce varsayılana düşürülmez: `unit_cost_cents`
                // NULL ise maliyet 0 olur ve kâr olduğundan çok görünür.
                let b_id: String = b
                    .try_get("id")
                    .map_err(|e| e.to_string())?;
                let b_rem: f64 = b
                    .try_get("remaining_quantity")
                    .map_err(|e| e.to_string())?;
                let b_cost: i64 = b
                    .try_get("unit_cost_cents")
                    .map_err(|e| e.to_string())?;

                let take = remaining_demand.min(b_rem);
                let cost = (take * b_cost as f64).round() as i64;
                item_cogs_cents += cost;
                remaining_demand -= take;

                sqlx::query(
                    "UPDATE inventory_batches SET remaining_quantity = remaining_quantity - ? \
                     WHERE tenant_id = ? AND id = ?",
                )
                .bind(take)
                .bind(tenant_id)
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

            // Partilerden karşılanamayan bakiye: satış engellenmez (POS'ta satış
            // her zaman alınabilir) ama miktar sıfır maliyetle geçiştirilmez;
            // ayrı sayılır ve olaya yazılır.
            if remaining_demand > 0.0 {
                total_deficit += remaining_demand;
                batch_allocations.push(serde_json::json!({
                    "batchId": "UNTRACKED_DEFICIT",
                    "quantity": remaining_demand,
                    "unitCostCents": null,
                    "totalCostCents": null,
                    "reason": "Bu ürün için parti girişi yok; gerçek maliyet bilinmiyor."
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

            // Ürünlerden stok miktarını düş (kiracı filtresi zorunlu)
            sqlx::query(
                "UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ? \
                 WHERE id = ? AND tenant_id = ? AND is_active = 1",
            )
            .bind(item.quantity)
            .bind(product_id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        }

        let fifo_payload = serde_json::json!({
            "transactionId": transaction_id,
            "totalCogsCents": total_cogs_cents,
            "untrackedDeficit": total_deficit,
            "allocations": allocations,
            "timestamp": now_iso,
            "ruleSet": "FIFO_DETERMINISTIC_WAL"
        });
        let fifo_event_id = format!("evt_fifo_{}", Uuid::new_v4());
        let fifo_json_str = serde_json::to_string(&fifo_payload).map_err(|e| e.to_string())?;

        // `events.tenant_id` NOT NULL DEFAULT'tur; kolon yazılmazsa olay
        // "DEFAULT_TENANT"e düşer ve kiracı defteri tutarsızlaşır.
        sqlx::query(
            "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
             VALUES (?, ?, ?, 'INVENTORY_ALLOCATION', 'FIFO_STOCK_DEDUCTED', ?, datetime('now'))",
        )
        .bind(&fifo_event_id)
        .bind(tenant_id)
        .bind(transaction_id)
        .bind(&fifo_json_str)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let outbox_fifo_id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, tenant_id, event_id, status, created_at) \
             VALUES (?, ?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&outbox_fifo_id)
        .bind(tenant_id)
        .bind(&fifo_event_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(FifoResult {
            total_cogs_cents,
            untracked_deficit: total_deficit,
        })
    }
}
