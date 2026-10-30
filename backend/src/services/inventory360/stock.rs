//! Stok görünümü yalnız gerçek FIFO partilerini okur.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Serialize)]
pub struct StockBatch {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub remaining_quantity: f64,
    pub unit_cost_cents: i64,
    pub received_at: String,
    pub expiry_date: Option<String>,
}

pub async fn list_stock_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<StockBatch>, String> {
    let rows = sqlx::query(
        "SELECT b.id, b.product_id, p.name AS product_name, b.remaining_quantity,
                b.unit_cost_cents, b.received_at, b.expiry_date
           FROM inventory_batches b
           JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
          WHERE b.tenant_id = ? AND b.remaining_quantity > 0
          ORDER BY p.name ASC, b.received_at ASC, b.id ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    rows.into_iter()
        .map(|row| {
            Ok(StockBatch {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
                product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
                remaining_quantity: row
                    .try_get("remaining_quantity")
                    .map_err(|e| e.to_string())?,
                unit_cost_cents: row.try_get("unit_cost_cents").map_err(|e| e.to_string())?,
                received_at: row.try_get("received_at").map_err(|e| e.to_string())?,
                expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}
