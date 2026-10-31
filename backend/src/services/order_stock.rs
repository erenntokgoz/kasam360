//! Adisyon kaleminin stok hareketi: mutfağa gidince düşer, iptalde geri döner.
//!
//! Neden kalem bazında: stok hesap kapanınca düştüğünde masa açıkken tükenen ürün
//! görünmüyordu. Düşüm erkene alınınca iptal de stoğu ilgilendirir; hangi partiden ne
//! kadar alındığı kaydın kendisinde durduğu için geri dönüş aynı partiye yapılır ve
//! FIFO maliyeti bozulmaz.
//!
//! `stock_source_id` düşümün kaydını gösterir. Bölünen kalem aynı kaydı paylaşır, bu
//! yüzden tutarlar kalemin adedine orantılanır. Boş olması düşüm yapılmadığı demektir.

use crate::commands::CartItemDto;
use crate::services::inventory_service::{FifoResult, InventoryService};
use crate::services::stock_trail::{self, StockMove};
use sqlx::{Row, SqliteConnection, SqlitePool};

/// Mutfak zayi bildirdiyse malzeme hazırlıktan önce de kaybolmuştur.
const WASTE_REASON_MARK: &str = "zayi";

struct LineAllocation {
    quantity: i64,
    cost_cents: i64,
    deficit: f64,
    batches: Vec<(String, f64)>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Eski veritabanında kolon yoktur; açık adisyonlar yükseltmeden sağ çıkmalıdır.
pub async fn ensure_column(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('order_items') WHERE name = 'stock_source_id'",
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        sqlx::query("ALTER TABLE order_items ADD COLUMN stock_source_id TEXT")
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Hazırlığı başlamış kalemin malzemesi geri dönmez: iptal fire olur.
fn is_waste(status: &str, reason: &str) -> bool {
    !status.eq_ignore_ascii_case("Pending") || reason.to_lowercase().contains(WASTE_REASON_MARK)
}

/// Kalemin stoğunu düşer. Kaydın kimliği kalem kimliğidir, iptal onu bulur.
pub async fn deduct_line(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    item_id: &str,
    product_id: &str,
    quantity: i64,
    now_iso: &str,
) -> Result<(), String> {
    let line = CartItemDto {
        id: item_id.to_string(),
        product: serde_json::json!({ "id": product_id }),
        quantity,
        ..CartItemDto::default()
    };
    InventoryService::execute_fifo_deduction(conn, tenant_id, item_id, &[line], now_iso).await?;
    Ok(())
}

async fn load_allocation(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    source_id: &str,
) -> Result<LineAllocation, String> {
    let raw: String = sqlx::query_scalar(
        "SELECT payload FROM events
         WHERE tenant_id = ? AND aggregate_id = ? AND event_type = 'FIFO_STOCK_DEDUCTED'
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(source_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| format!("INTERNAL: stok düşüm kaydı bulunamadı: {source_id}"))?;
    let payload: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let line = &payload["allocations"][0];
    let quantity = line["quantity"]
        .as_i64()
        .filter(|quantity| *quantity > 0)
        .ok_or_else(|| "INTERNAL: stok kaydında adet eksik".to_string())?;
    let cost_cents = line["totalCostCents"]
        .as_i64()
        .ok_or_else(|| "INTERNAL: stok kaydında maliyet eksik".to_string())?;
    let mut batches = Vec::new();
    for batch in line["batches"].as_array().into_iter().flatten() {
        let id = batch["batchId"].as_str().unwrap_or_default();
        if id == "UNTRACKED_DEFICIT" {
            continue;
        }
        let taken = batch["quantity"]
            .as_f64()
            .ok_or_else(|| "INTERNAL: stok kaydında parti miktarı eksik".to_string())?;
        batches.push((id.to_string(), taken));
    }
    Ok(LineAllocation {
        quantity,
        cost_cents,
        deficit: payload["untrackedDeficit"].as_f64().unwrap_or(0.0),
        batches,
    })
}

/// İptal edilen kalemin stoğunu çözer; fire yazıldıysa maliyetini döndürür.
pub async fn release_line(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    item_id: &str,
    reason: &str,
    actor_id: &str,
    now_iso: &str,
) -> Result<Option<i64>, String> {
    let row =
        sqlx::query("SELECT product_id, quantity, status, stock_source_id FROM order_items WHERE id = ? AND tenant_id = ?")
            .bind(item_id)
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(text_error)?;
    let source: Option<String> = row.try_get("stock_source_id").map_err(text_error)?;
    let Some(source) = source else {
        return Ok(None);
    };
    let quantity: i64 = row.try_get("quantity").map_err(text_error)?;
    let product_id: String = row.try_get("product_id").map_err(text_error)?;
    let allocation = load_allocation(conn, tenant_id, &source).await?;

    let status: String = row.try_get("status").map_err(text_error)?;
    if is_waste(&status, reason) {
        let cost = allocation.cost_cents * quantity / allocation.quantity;
        sqlx::query(
            "INSERT INTO waste_records (id, tenant_id, product_id, reason, quantity,
                                        total_cost_cents, occurred_at, recorded_by, notes)
             VALUES (?, ?, ?, 'FIRE_EDILDI', ?, ?, ?, ?, ?)",
        )
        .bind(crate::id_generator::generate_id("wst"))
        .bind(tenant_id)
        .bind(&product_id)
        .bind(quantity as f64)
        .bind(cost)
        .bind(now_iso)
        .bind(actor_id)
        .bind(reason)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
        stock_trail::record(
            conn,
            tenant_id,
            StockMove {
                product_id: &product_id,
                movement_type: "WASTE",
                quantity: quantity as f64,
                actor_id,
                reason: Some(reason),
                source_type: stock_trail::SOURCE_ORDER_ITEM,
                source_id: item_id,
            },
        )
        .await?;
        return Ok(Some(cost));
    }

    let share = quantity as f64 / allocation.quantity as f64;
    for (batch_id, taken) in &allocation.batches {
        sqlx::query(
            "UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ?
             WHERE tenant_id = ? AND id = ?",
        )
        .bind(taken * share)
        .bind(tenant_id)
        .bind(batch_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    }
    stock_trail::record(
        conn,
        tenant_id,
        StockMove {
            product_id: &product_id,
            movement_type: "IN",
            quantity: quantity as f64,
            actor_id,
            reason: Some(reason),
            source_type: stock_trail::SOURCE_ORDER_VOID,
            source_id: item_id,
        },
    )
    .await?;
    Ok(None)
}

/// Kapanan adisyonun maliyeti, kalemlerin düşüm kayıtlarından toplanır.
///
/// Yükseltmeden önce mutfağa gitmiş kalemin stoğu burada düşer: sayı tek kez düşmeli,
/// hiç düşmeden de kapanmamalıdır.
pub async fn settle_order_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    now_iso: &str,
) -> Result<FifoResult, String> {
    let rows = sqlx::query(
        "SELECT id, product_id, quantity, stock_source_id FROM order_items
         WHERE order_id = ? AND tenant_id = ? AND status != 'CANCELLED'",
    )
    .bind(order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;

    let mut result = FifoResult {
        total_cogs_cents: 0,
        untracked_deficit: 0.0,
    };
    for row in rows {
        let item_id: String = row.try_get("id").map_err(text_error)?;
        let quantity: i64 = row.try_get("quantity").map_err(text_error)?;
        let source: Option<String> = row.try_get("stock_source_id").map_err(text_error)?;
        let source = match source {
            Some(source) => source,
            None => {
                let product_id: String = row.try_get("product_id").map_err(text_error)?;
                deduct_line(conn, tenant_id, &item_id, &product_id, quantity, now_iso).await?;
                sqlx::query(
                    "UPDATE order_items SET stock_source_id = id WHERE id = ? AND tenant_id = ?",
                )
                .bind(&item_id)
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
                .map_err(text_error)?;
                item_id
            }
        };
        let allocation = load_allocation(conn, tenant_id, &source).await?;
        result.total_cogs_cents = result
            .total_cogs_cents
            .checked_add(allocation.cost_cents * quantity / allocation.quantity)
            .ok_or_else(|| "OVERFLOW: satış maliyeti taştı".to_string())?;
        result.untracked_deficit +=
            allocation.deficit * quantity as f64 / allocation.quantity as f64;
    }
    Ok(result)
}

#[cfg(test)]
#[path = "order_stock_tests.rs"]
mod tests;
