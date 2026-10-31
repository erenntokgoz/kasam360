//! Deterministik gerçek FIFO parti/lot tüketimi ve COGS hesaplaması.
//!
//! Sahte %35 maliyet formülü tamamen kaldırılmıştır; maliyet
//! `inventory_batches` üzerinden en eski partiden başlanarak düşülür.

use crate::commands::CartItemDto;
use crate::services::inventory360::quantity_cost::line_cost_cents;
use crate::services::inventory360::units::convert_stock_quantity;
use sqlx::Row;

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
            let sold_quantity = item.quantity as f64;

            // Önce bu ürün için aktif bir reçete var mı kontrol et
            let active_recipe = sqlx::query(
                "SELECT id, output_quantity, yield_percent \
                 FROM recipes \
                 WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
            )
            .bind(tenant_id)
            .bind(product_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

            let mut item_cogs_cents: i64 = 0;
            let mut batch_allocations = Vec::new();
            let rule_name: &str;

            if let Some(recipe_row) = active_recipe {
                rule_name = "FIFO_BOM_RECIPE";
                let recipe_id: String = recipe_row.try_get("id").map_err(|e| e.to_string())?;
                let output_quantity: f64 = recipe_row
                    .try_get("output_quantity")
                    .map_err(|e| e.to_string())?;
                let yield_percent: f64 = recipe_row
                    .try_get("yield_percent")
                    .map_err(|e| e.to_string())?;

                if !yield_percent.is_finite()
                    || yield_percent <= 0.0
                    || yield_percent > 100.0
                    || !output_quantity.is_finite()
                    || output_quantity <= 0.0
                {
                    return Err("STOCK: reçete randımanı veya üretim miktarı geçersiz".into());
                }
                let recipe_scale = (sold_quantity / output_quantity) / (yield_percent / 100.0);
                if !recipe_scale.is_finite() || recipe_scale <= 0.0 {
                    return Err("STOCK: reçete ölçeği geçersiz".into());
                }

                let recipe_items = sqlx::query(
                    "SELECT component_product_id, quantity, unit, waste_percent \
                     FROM recipe_items \
                     WHERE tenant_id = ? AND recipe_id = ? \
                     ORDER BY created_at ASC, id ASC",
                )
                .bind(tenant_id)
                .bind(&recipe_id)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

                for ri in recipe_items {
                    let comp_product_id: String = ri
                        .try_get("component_product_id")
                        .map_err(|e| e.to_string())?;
                    let comp_qty: f64 = ri.try_get("quantity").map_err(|e| e.to_string())?;
                    let recipe_unit: String = ri.try_get("unit").map_err(|e| e.to_string())?;
                    let waste_pct: f64 = ri.try_get("waste_percent").map_err(|e| e.to_string())?;

                    if !comp_qty.is_finite()
                        || comp_qty <= 0.0
                        || !waste_pct.is_finite()
                        || !(0.0..100.0).contains(&waste_pct)
                    {
                        return Err("STOCK: reçete malzeme miktarı veya fire oranı geçersiz".into());
                    }
                    let waste_factor = 1.0 - (waste_pct / 100.0);
                    let stock_unit: String = sqlx::query_scalar(
                        "SELECT stock_unit FROM products WHERE tenant_id = ? AND id = ?",
                    )
                    .bind(tenant_id)
                    .bind(&comp_product_id)
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;
                    let recipe_demand = (comp_qty / waste_factor) * recipe_scale;
                    let mut comp_remaining_demand = convert_stock_quantity(
                        conn,
                        tenant_id,
                        &recipe_unit,
                        &stock_unit,
                        recipe_demand,
                    )
                    .await?;

                    let batch_rows = sqlx::query(
                        "SELECT id, remaining_quantity, unit_cost_cents \
                         FROM inventory_batches \
                         WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0 \
                         ORDER BY received_at ASC, id ASC",
                    )
                    .bind(tenant_id)
                    .bind(&comp_product_id)
                    .fetch_all(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                    for b in batch_rows {
                        if comp_remaining_demand <= 0.0 {
                            break;
                        }
                        let b_id: String = b.try_get("id").map_err(|e| e.to_string())?;
                        let b_rem: f64 =
                            b.try_get("remaining_quantity").map_err(|e| e.to_string())?;
                        let b_cost: i64 =
                            b.try_get("unit_cost_cents").map_err(|e| e.to_string())?;

                        let take = comp_remaining_demand.min(b_rem);
                        let cost = line_cost_cents(b_cost, take)?;
                        item_cogs_cents = item_cogs_cents
                            .checked_add(cost)
                            .ok_or_else(|| "OVERFLOW: satış maliyeti taştı".to_string())?;
                        comp_remaining_demand -= take;

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
                            "componentProductId": comp_product_id,
                            "batchId": b_id,
                            "quantity": take,
                            "unitCostCents": b_cost,
                            "totalCostCents": cost
                        }));
                    }

                    if comp_remaining_demand > 0.0 {
                        total_deficit += comp_remaining_demand;
                        batch_allocations.push(serde_json::json!({
                            "componentProductId": comp_product_id,
                            "batchId": "UNTRACKED_DEFICIT",
                            "quantity": comp_remaining_demand,
                            "unitCostCents": null,
                            "totalCostCents": null,
                            "reason": "Reçete bileşeni için parti girişi yok; gerçek maliyet bilinmiyor."
                        }));
                    }
                }
            } else {
                rule_name = "FIFO_DETERMINISTIC_BATCH";
                let stock_unit: String = sqlx::query_scalar(
                    "SELECT stock_unit FROM products WHERE tenant_id = ? AND id = ?",
                )
                .bind(tenant_id)
                .bind(product_id)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
                let mut remaining_demand =
                    convert_stock_quantity(conn, tenant_id, "adet", &stock_unit, sold_quantity)
                        .await?;

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

                for b in batch_rows {
                    if remaining_demand <= 0.0 {
                        break;
                    }
                    let b_id: String = b.try_get("id").map_err(|e| e.to_string())?;
                    let b_rem: f64 = b.try_get("remaining_quantity").map_err(|e| e.to_string())?;
                    let b_cost: i64 = b.try_get("unit_cost_cents").map_err(|e| e.to_string())?;

                    let take = remaining_demand.min(b_rem);
                    let cost = line_cost_cents(b_cost, take)?;
                    item_cogs_cents = item_cogs_cents
                        .checked_add(cost)
                        .ok_or_else(|| "OVERFLOW: satış maliyeti taştı".to_string())?;
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
            }

            total_cogs_cents = total_cogs_cents
                .checked_add(item_cogs_cents)
                .ok_or_else(|| "OVERFLOW: toplam satış maliyeti taştı".to_string())?;
            allocations.push(serde_json::json!({
                "itemId": item.id,
                "productId": product_id,
                "quantity": item.quantity,
                "totalCostCents": item_cogs_cents,
                "batches": batch_allocations,
                "rule": rule_name
            }));
        }

        let fifo_payload = serde_json::json!({
            "transactionId": transaction_id,
            "totalCogsCents": total_cogs_cents,
            "untrackedDeficit": total_deficit,
            "allocations": allocations,
            "timestamp": now_iso,
            "ruleSet": "FIFO_DETERMINISTIC_WAL"
        });
        let fifo_event_id = crate::id_generator::generate_id("evt_fifo");
        let fifo_json_str = serde_json::to_string(&fifo_payload).map_err(|e| e.to_string())?;

        // `events.tenant_id` NOT NULL DEFAULT'tur; kolon yazılmazsa olay
        // varsayılan kiracıya düşer ve kiracı defteri tutarsızlaşır.
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

        let outbox_fifo_id = crate::id_generator::generate_id("outbox");
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
