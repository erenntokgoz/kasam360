//! Reçete kalemlerinin kayıt öncesi denetimi.
//!
//! Neden kayıtta: birimi uyumsuz bir kalem (kilo ile tutulan una "ml" yazmak)
//! kayıt anında reddedilmezse reçete sessizce kaydolur, ilk satışta ödeme
//! "çevrilemiyor" hatasıyla durur. Aynı malzemenin iki satırda yazılması da
//! stoktan iki kez düşüm ve şişmiş maliyet demektir. Döngüsel reçete (A → B → A)
//! kayıtta yakalanmazsa maliyet ekranı ve satış her seferinde hata verir.

use super::types::{RecipeInput, MAX_RECIPE_DEPTH};
use crate::services::inventory360::batch_demand::component_demand;
use crate::services::inventory360::units::convert_stock_quantity;
use sqlx::SqliteConnection;

const RECIPE_UNITS: [&str; 5] = ["adet", "g", "kg", "ml", "l"];

fn valid_unit(unit: &str) -> bool {
    RECIPE_UNITS.contains(&unit)
}

/// Girdi kalemlerini birim, tekrar ve döngü açısından sınar.
pub(super) async fn validate_recipe_items(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &RecipeInput,
) -> Result<(), String> {
    if input.name.trim().is_empty() {
        return Err("VALIDATION: reçete adı gerekli".into());
    }
    if !valid_unit(&input.output_unit) {
        return Err("VALIDATION: üretim birimi adet, g, kg, ml veya l olmalı".into());
    }
    let mut seen: Vec<&str> = Vec::with_capacity(input.items.len());
    for item in &input.items {
        if seen.contains(&item.component_product_id.as_str()) {
            return Err("VALIDATION: her malzeme reçetede yalnız bir kez yer alabilir".into());
        }
        seen.push(&item.component_product_id);
        if !valid_unit(&item.unit) {
            return Err("VALIDATION: malzeme birimi adet, g, kg, ml veya l olmalı".into());
        }
        ensure_unit_compatible(conn, tenant_id, &item.component_product_id, &item.unit).await?;
        if reaches_product(
            conn,
            tenant_id,
            &item.component_product_id,
            &input.product_id,
        )
        .await?
        {
            return Err("VALIDATION: döngüsel reçete tanımı, malzeme bu ürünü içeriyor".into());
        }
    }
    Ok(())
}

/// Malzemenin miktarı satışta çözülebilecek mi? Alt reçetesi olan malzeme o
/// reçetenin üretim birimine, olmayan kendi stok birimine çevrilebilmelidir.
async fn ensure_unit_compatible(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    component_id: &str,
    unit: &str,
) -> Result<(), String> {
    let output_unit: Option<String> = sqlx::query_scalar(
        "SELECT output_unit FROM recipes WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(component_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let result = match output_unit {
        Some(output_unit) => convert_stock_quantity(conn, tenant_id, unit, &output_unit, 1.0)
            .await
            .map(|_| ()),
        None => {
            let stock_unit: String = sqlx::query_scalar(
                "SELECT stock_unit FROM products WHERE tenant_id = ? AND id = ?",
            )
            .bind(tenant_id)
            .bind(component_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            component_demand(conn, tenant_id, unit, &stock_unit, 1.0)
                .await
                .map(|_| ())
        }
    };
    result.map_err(|error| {
        if error.starts_with("STOCK:") {
            error
        } else {
            "VALIDATION: malzeme birimi stok birimiyle uyumsuz".to_string()
        }
    })
}

/// `start` ürününün aktif reçete ağacında `target` var mı?
async fn reaches_product(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    start: &str,
    target: &str,
) -> Result<bool, String> {
    let mut frontier = vec![start.to_string()];
    let mut seen: Vec<String> = Vec::new();
    for _ in 0..=MAX_RECIPE_DEPTH {
        let mut next = Vec::new();
        for product_id in frontier {
            if product_id == target {
                return Ok(true);
            }
            if seen.contains(&product_id) {
                continue;
            }
            let children: Vec<String> = sqlx::query_scalar(
                "SELECT ri.component_product_id FROM recipe_items ri
                   JOIN recipes r ON r.id = ri.recipe_id AND r.tenant_id = ri.tenant_id
                  WHERE ri.tenant_id = ? AND r.product_id = ? AND r.is_active = 1",
            )
            .bind(tenant_id)
            .bind(&product_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            seen.push(product_id);
            next.extend(children);
        }
        if next.is_empty() {
            return Ok(false);
        }
        frontier = next;
    }
    Err(format!(
        "VALIDATION: alt yarı mamul zinciri {MAX_RECIPE_DEPTH} seviyeyi aşıyor"
    ))
}
