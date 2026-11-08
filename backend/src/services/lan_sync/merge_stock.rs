//! Birleşmeden sonra eksiye düşen stok partisinin FIFO düzeltmesi.
//!
//! İki adada aynı partiden satılınca farklar toplanır ve parti eksiye düşebilir. Açık,
//! aynı ürünün (veya hammaddenin) sonraki partilerinden giriş sırasıyla düşülür: gerçek
//! FIFO'da o mal sonraki partiden çıkmıştır. Karşılanamayan açık sessizce sıfırlanmaz;
//! parti eksi kalır ve `STOCK_NEGATIVE` çakışması sayım için kuyruğa düşer. Sıra yalnız
//! giriş zamanı ve kimliğe bağlıdır; her cihaz aynı düzeltmeyi yapar.

use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};
use std::collections::BTreeSet;

/// Kayan nokta artığı açık sayılmaz.
const EPSILON: f64 = 1e-9;

#[derive(Default)]
pub(super) struct Corrections {
    pub(super) conflicts: Vec<Value>,
    pub(super) moves: Vec<Value>,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

async fn set_remaining(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    batch_id: &str,
    remaining: f64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE inventory_batches SET remaining_quantity = ? WHERE id = ? AND tenant_id = ?",
    )
    .bind(remaining)
    .bind(batch_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Dokunulan partilerden eksiye düşenleri düzeltir.
pub(super) async fn settle_negative(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    batches: &BTreeSet<String>,
) -> Result<Corrections, String> {
    let mut corrections = Corrections::default();
    for batch_id in batches {
        let Some(row) = sqlx::query(
            "SELECT remaining_quantity, product_id, inventory_item_id FROM inventory_batches
             WHERE id = ? AND tenant_id = ?",
        )
        .bind(batch_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?
        else {
            continue;
        };
        let remaining: f64 = row.try_get("remaining_quantity").map_err(text_error)?;
        if remaining >= -EPSILON {
            continue;
        }
        let product: Option<String> = row.try_get("product_id").map_err(text_error)?;
        let item: Option<String> = row.try_get("inventory_item_id").map_err(text_error)?;
        let donors = sqlx::query(
            "SELECT id, remaining_quantity FROM inventory_batches
             WHERE tenant_id = ? AND id != ? AND remaining_quantity > 0
               AND ((? IS NOT NULL AND product_id = ?) OR (? IS NOT NULL AND inventory_item_id = ?))
             ORDER BY received_at ASC, id ASC",
        )
        .bind(tenant_id)
        .bind(batch_id)
        .bind(&product)
        .bind(&product)
        .bind(&item)
        .bind(&item)
        .fetch_all(&mut *conn)
        .await
        .map_err(text_error)?;
        let mut deficit = -remaining;
        for donor in donors {
            if deficit <= EPSILON {
                break;
            }
            let donor_id: String = donor.try_get("id").map_err(text_error)?;
            let available: f64 = donor.try_get("remaining_quantity").map_err(text_error)?;
            let taken = available.min(deficit);
            set_remaining(conn, tenant_id, &donor_id, available - taken).await?;
            deficit -= taken;
            corrections
                .moves
                .push(json!({ "from": donor_id, "to": batch_id, "quantity": taken }));
        }
        let left = if deficit <= EPSILON { 0.0 } else { -deficit };
        set_remaining(conn, tenant_id, batch_id, left).await?;
        if left < 0.0 {
            corrections.conflicts.push(json!({
                "kind": "STOCK_NEGATIVE",
                "table": "inventory_batches",
                "key": batch_id,
                "remaining": left,
            }));
        }
    }
    Ok(corrections)
}
