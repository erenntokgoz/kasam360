//! Kör sayım eksiğini gerçek FIFO partilerine uygular ve maliyetini hesaplar.

use sqlx::{Row, SqliteConnection};

use crate::services::inventory360::quantity_cost::line_cost_cents;

pub(super) async fn apply_count_variance(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    batch_total: Option<f64>,
    variance: Option<f64>,
    apply_adjustment: bool,
) -> Result<Option<i64>, String> {
    if apply_adjustment && batch_total.is_none() {
        return Err("STOCK: partisi olmayan ürünün sayım farkı uygulanamaz".into());
    }
    if apply_adjustment && variance.is_some_and(|difference| difference > f64::EPSILON) {
        return Err("STOCK: fazla stok maliyetli alış girişiyle kaydedilmeli".into());
    }

    // Fazla stokun alış maliyeti bilinmediğinden değeri uydurulmaz.
    let shortage = match variance {
        None => return Ok(None),
        Some(difference) if difference.abs() <= f64::EPSILON => return Ok(Some(0)),
        Some(difference) if difference > 0.0 || batch_total.is_none() => return Ok(None),
        Some(difference) => -difference,
    };
    let batches = sqlx::query(
        "SELECT id, remaining_quantity, unit_cost_cents FROM inventory_batches
          WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
          ORDER BY received_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut remaining_shortage = shortage;
    let mut cost_cents = 0i64;
    for batch in batches {
        if remaining_shortage <= f64::EPSILON {
            break;
        }
        let id: String = batch.try_get("id").map_err(|e| e.to_string())?;
        let remaining: f64 = batch
            .try_get("remaining_quantity")
            .map_err(|e| e.to_string())?;
        let unit_cost_cents: i64 = batch
            .try_get("unit_cost_cents")
            .map_err(|e| e.to_string())?;
        let taken = remaining_shortage.min(remaining);
        cost_cents = cost_cents
            .checked_add(line_cost_cents(unit_cost_cents, taken)?)
            .ok_or_else(|| "OVERFLOW: sayım fark maliyeti taştı".to_string())?;
        if apply_adjustment {
            sqlx::query(
                "UPDATE inventory_batches SET remaining_quantity = ? WHERE id = ? AND tenant_id = ?",
            )
            .bind(remaining - taken)
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        }
        remaining_shortage -= taken;
    }
    if remaining_shortage > f64::EPSILON {
        return Err("STOCK: sayım farkı FIFO partileriyle karşılanamadı".into());
    }
    cost_cents
        .checked_neg()
        .map(Some)
        .ok_or_else(|| "OVERFLOW: sayım fark maliyeti taştı".to_string())
}
