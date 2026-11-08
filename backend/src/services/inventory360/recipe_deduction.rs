//! Satışta reçete malzemelerinin FIFO partilerinden düşülmesi.
//!
//! Neden ayrı: maliyet çözümleyici (`recipes::cost`) yarı mamulün kendi
//! reçetesine iner, satış düşümü inmezse ekranda görülen maliyet ile defterdeki
//! satış maliyeti ayrışır. Hamurun partisi olmadığı için her kruasan satışı
//! "parti yok" açığı yazar, unun stoğu hiç azalmaz. Bu modül iki tarafı aynı
//! kuralla yürütür: aktif reçetesi olan malzeme reçetesine açılır, olmayan kendi
//! partilerinden düşülür.

use super::batch_demand::component_demand;
use super::quantity_cost::line_cost_cents;
use super::recipes::types::MAX_RECIPE_DEPTH;
use super::units::convert_stock_quantity;
use sqlx::{Row, SqliteConnection};

/// Bir satış kaleminin düşüm sonucu. Açık miktar sıfır sayılmaz; çağıran
/// defterde ve radarda gösterir.
#[derive(Debug, Default)]
pub(crate) struct DeductionTotals {
    pub cogs_cents: i64,
    pub deficit: f64,
}

/// Reçeteyi `scale` katıyla düşer. `visiting` kökten bu reçeteye uzanan ürün
/// zinciridir; döngüsel tanım sonsuz özyineleme yerine hata verir.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn deduct_recipe(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_id: &str,
    scale: f64,
    visiting: &mut Vec<String>,
    depth: usize,
    allocations: &mut Vec<serde_json::Value>,
    totals: &mut DeductionTotals,
) -> Result<(), String> {
    if depth > MAX_RECIPE_DEPTH {
        return Err(format!(
            "STOCK: alt yarı mamul zinciri {MAX_RECIPE_DEPTH} seviyeyi aşıyor, döngüsel reçete tanımı"
        ));
    }
    let recipe_items = sqlx::query(
        "SELECT component_product_id, quantity, unit, waste_percent \
         FROM recipe_items \
         WHERE tenant_id = ? AND recipe_id = ? \
         ORDER BY created_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(recipe_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for ri in recipe_items {
        let component_id: String = ri
            .try_get("component_product_id")
            .map_err(|e| e.to_string())?;
        let quantity: f64 = ri.try_get("quantity").map_err(|e| e.to_string())?;
        let recipe_unit: String = ri.try_get("unit").map_err(|e| e.to_string())?;
        let waste_pct: f64 = ri.try_get("waste_percent").map_err(|e| e.to_string())?;
        if !quantity.is_finite()
            || quantity <= 0.0
            || !waste_pct.is_finite()
            || !(0.0..100.0).contains(&waste_pct)
        {
            return Err("STOCK: reçete malzeme miktarı veya fire oranı geçersiz".into());
        }
        let demand = (quantity / (1.0 - waste_pct / 100.0)) * scale;

        let sub_recipe: Option<(String, f64, String, f64)> = sqlx::query_as(
            "SELECT id, output_quantity, output_unit, yield_percent FROM recipes
              WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
        )
        .bind(tenant_id)
        .bind(&component_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        match sub_recipe {
            Some((sub_id, output_quantity, output_unit, yield_percent)) => {
                if visiting.iter().any(|visited| visited == &component_id) {
                    return Err(format!(
                        "STOCK: döngüsel reçete tanımı, {component_id} kendi kendini içeriyor"
                    ));
                }
                if !yield_percent.is_finite()
                    || yield_percent <= 0.0
                    || yield_percent > 100.0
                    || !output_quantity.is_finite()
                    || output_quantity <= 0.0
                {
                    return Err("STOCK: reçete randımanı veya üretim miktarı geçersiz".into());
                }
                let needed =
                    convert_stock_quantity(conn, tenant_id, &recipe_unit, &output_unit, demand)
                        .await?;
                let sub_scale = (needed / output_quantity) / (yield_percent / 100.0);
                if !sub_scale.is_finite() || sub_scale <= 0.0 {
                    return Err("STOCK: reçete ölçeği geçersiz".into());
                }
                visiting.push(component_id);
                Box::pin(deduct_recipe(
                    conn,
                    tenant_id,
                    &sub_id,
                    sub_scale,
                    visiting,
                    depth + 1,
                    allocations,
                    totals,
                ))
                .await?;
                visiting.pop();
            }
            None => {
                deduct_component_batches(
                    conn,
                    tenant_id,
                    &component_id,
                    &recipe_unit,
                    demand,
                    allocations,
                    totals,
                )
                .await?;
            }
        }
    }
    Ok(())
}

/// Reçetesiz malzemeyi en eski partiden başlayarak düşer.
async fn deduct_component_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    component_id: &str,
    recipe_unit: &str,
    quantity: f64,
    allocations: &mut Vec<serde_json::Value>,
    totals: &mut DeductionTotals,
) -> Result<(), String> {
    let stock_unit: String =
        sqlx::query_scalar("SELECT stock_unit FROM products WHERE tenant_id = ? AND id = ?")
            .bind(tenant_id)
            .bind(component_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    let mut demand = component_demand(conn, tenant_id, recipe_unit, &stock_unit, quantity).await?;

    let batch_rows = sqlx::query(
        "SELECT id, remaining_quantity, unit_cost_cents, usable_grams_per_unit \
           FROM inventory_batches \
          WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0 \
          ORDER BY received_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(component_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut last_grams_per_unit: Option<f64> = None;
    for b in batch_rows {
        if !demand.is_open() {
            break;
        }
        let b_id: String = b.try_get("id").map_err(|e| e.to_string())?;
        let b_rem: f64 = b.try_get("remaining_quantity").map_err(|e| e.to_string())?;
        let b_cost: i64 = b.try_get("unit_cost_cents").map_err(|e| e.to_string())?;
        let grams_per_unit: Option<f64> = b
            .try_get("usable_grams_per_unit")
            .map_err(|e| e.to_string())?;
        if grams_per_unit.is_some() {
            last_grams_per_unit = grams_per_unit;
        }

        let take = demand.take(b_rem, grams_per_unit);
        if take <= 0.0 {
            continue;
        }
        let cost = line_cost_cents(b_cost, take)?;
        totals.cogs_cents = totals
            .cogs_cents
            .checked_add(cost)
            .ok_or_else(|| "OVERFLOW: satış maliyeti taştı".to_string())?;

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

        allocations.push(serde_json::json!({
            "componentProductId": component_id,
            "batchId": b_id,
            "quantity": take,
            "unitCostCents": b_cost,
            "totalCostCents": cost
        }));
    }

    if demand.is_open() {
        // Gram açığı stok biriminde (adet) yazılır; hareket defteri adetle
        // tutulur. Hiç gram bilgisi yoksa adet karşılığı bilinemez.
        let (missing, missing_grams) = if demand.is_grams() {
            let grams = demand.remaining();
            (
                last_grams_per_unit.map_or(0.0, |per_unit| grams / per_unit),
                Some(grams),
            )
        } else {
            (demand.remaining(), None)
        };
        totals.deficit += if missing > 0.0 {
            missing
        } else {
            demand.remaining()
        };
        allocations.push(serde_json::json!({
            "componentProductId": component_id,
            "batchId": "UNTRACKED_DEFICIT",
            "quantity": missing,
            "missingGrams": missing_grams,
            "unitCostCents": null,
            "totalCostCents": null,
            "reason": "Reçete bileşeni için parti girişi yok; gerçek maliyet bilinmiyor."
        }));
    }
    Ok(())
}
