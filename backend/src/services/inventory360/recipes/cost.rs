use super::types::{round_cents, ComponentCost, RecipeCost, MAX_RECIPE_DEPTH};
use sqlx::{Row, SqliteConnection};

/// Malzemenin birim maliyetini çözer.
///
/// Öncelik sırası:
///   1. Alt yarı mamul reçetesi varsa reçetenin birim maliyeti (özyinelemeli).
///   2. Stok partilerinin en güncel birim maliyeti.
///   3. Tedarikçi fiyatı (stoktan hiç girmemiş malzeme için).
/// Biri de yoksa None döner — sıfır değil.
pub(super) async fn resolve_component_cost(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    visiting: &mut Vec<String>,
    depth: usize,
) -> Result<Option<i64>, String> {
    if depth > MAX_RECIPE_DEPTH {
        return Err(format!(
            "VALIDATION: alt yarı mamul zinciri {MAX_RECIPE_DEPTH} seviyeyi aşıyor, döngüsel reçete tanımı"
        ));
    }
    if visiting.iter().any(|visited| visited == product_id) {
        return Err(format!(
            "VALIDATION: döngüsel reçete tanımı, {product_id} kendi kendini içeriyor"
        ));
    }
    // Burada `visiting`'e ekleme yapılmaz: alt reçetenin maliyeti
    // `calculate_recipe_cost_inner` içinde çözülür ve o yordam kendi
    // `product_id`'sini listeye ekler. İki yerde de eklenirse geçerli bir
    // zincir (kahve → hamur → un) hata sanılır ve maliyet hiç çözülemez.

    // 1) Aktif alt reçete
    let alt_recipe: Option<(String, f64)> = sqlx::query_as(
        "SELECT id, output_quantity FROM recipes
          WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let sonuc = match alt_recipe {
        Some((alt_id, output_quantity)) => {
            let ic = Box::pin(calculate_recipe_cost_inner(
                conn,
                tenant_id,
                &alt_id,
                visiting,
                depth + 1,
            ))
            .await?;
            ic.standard_cost_cents.map(|tam| {
                // Alt reçete `output_quantity` adet üretimin toplam maliyetini
                // verir; istenen malzeme adedine ölçeklemek için bölünür.
                ((tam as f64) / output_quantity).round() as i64
            })
        }
        None => {
            // 2) Stok partilerinden en güncel birim maliyet
            let batch_cost: Option<i64> = sqlx::query_scalar(
                "SELECT unit_cost_cents FROM inventory_batches
                  WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
                  ORDER BY received_at DESC, id DESC LIMIT 1",
            )
            .bind(tenant_id)
            .bind(product_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

            match batch_cost {
                Some(cost) => Some(cost),
                // 3) Tedarikçi fiyatı (ilk alım henüz yapılmamışsa)
                None => sqlx::query_scalar(
                    "SELECT sp.unit_cost_cents
                       FROM supplier_products sp
                       JOIN suppliers s ON s.id = sp.supplier_id AND s.tenant_id = sp.tenant_id
                      WHERE sp.tenant_id = ? AND sp.product_id = ? AND s.is_active = 1
                      ORDER BY sp.is_preferred DESC, sp.unit_cost_cents ASC LIMIT 1",
                )
                .bind(tenant_id)
                .bind(product_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?,
            }
        }
    };

    Ok(sonuc)
}

/// Reçetenin maliyet dökümünü çözer.
///
/// `quantity` verilmezse reçetenin standart üretim miktarı kullanılır.
///
/// Dönüşüm: malzeme maliyetlerinin toplamı randıman ve fire paylarıyla
/// düzeltilerek birim maliyete bölünür. Randıman %80 ve malzeme toplamı 10000
/// kuruşsa, üretilen 100 birim için fire 2000 kuruştur ve birim maliyet
/// 10000 / 80 = 125 kuruş olur.
/// Genel amaçlı giriş noktası: verilen reçetenin standart üretim maliyetini
/// çözer. Özyineleme yolu içeride açılır, çağıran `visiting`/`depth` taşımaz.
pub async fn calculate_recipe_cost(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_id: &str,
) -> Result<RecipeCost, String> {
    let mut visiting = Vec::new();
    calculate_recipe_cost_inner(conn, tenant_id, recipe_id, &mut visiting, 0).await
}

pub async fn calculate_recipe_cost_inner(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_id: &str,
    visiting: &mut Vec<String>,
    depth: usize,
) -> Result<RecipeCost, String> {
    let header = sqlx::query(
        "SELECT r.product_id, r.yield_percent, r.output_quantity, r.output_unit, p.name AS product_name
           FROM recipes r
           JOIN products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id
          WHERE r.id = ? AND r.tenant_id = ?",
    )
    .bind(recipe_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: reçete bulunamadı".to_string())?;

    let product_id: String = header.try_get("product_id").map_err(|e| e.to_string())?;
    let product_name: String = header.try_get("product_name").map_err(|e| e.to_string())?;
    let yield_percent: f64 = header.try_get("yield_percent").map_err(|e| e.to_string())?;
    let output_quantity: f64 = header
        .try_get("output_quantity")
        .map_err(|e| e.to_string())?;
    let output_unit: String = header.try_get("output_unit").map_err(|e| e.to_string())?;

    if visiting.iter().any(|visited| visited == &product_id) {
        return Err(format!(
            "VALIDATION: döngüsel reçete tanımı, {product_name} kendi kendini içeriyor"
        ));
    }
    visiting.push(product_id.clone());

    let item_rows = sqlx::query(
        "SELECT ri.component_product_id, p.name AS component_name, ri.quantity,
                ri.unit, ri.waste_percent
           FROM recipe_items ri
           JOIN products p
             ON p.id = ri.component_product_id AND p.tenant_id = ri.tenant_id
          WHERE ri.tenant_id = ? AND ri.recipe_id = ?
          ORDER BY ri.created_at ASC",
    )
    .bind(tenant_id)
    .bind(recipe_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut components = Vec::new();
    let mut unresolved: Vec<String> = Vec::new();
    // `tamamlandi` bayrağı: tek bir bilinmeyen malzeme toplamı bilinmez yapar,
    // kalanları 0 saymaz (AGENTS.md §3.4).
    let mut toplam: f64 = 0.0;
    let mut tamamlandi = true;

    for row in item_rows {
        let component_product_id: String = row
            .try_get("component_product_id")
            .map_err(|e| e.to_string())?;
        let component_name: String = row.try_get("component_name").map_err(|e| e.to_string())?;
        let quantity: f64 = row.try_get("quantity").map_err(|e| e.to_string())?;
        let unit: String = row.try_get("unit").map_err(|e| e.to_string())?;
        let waste_percent: f64 = row.try_get("waste_percent").map_err(|e| e.to_string())?;

        let unit_cost =
            resolve_component_cost(conn, tenant_id, &component_product_id, visiting, depth + 1)
                .await?;

        // Fire payı malzeme ihtiyacını büyütür: %10 fire varsa 1 birim üretim
        // için 1 / (1 - 0.10) = 1.111 birim malzeme harcanır.
        let needed = quantity / (1.0 - waste_percent / 100.0);
        let line_cost = unit_cost.map(|cost| (needed * cost as f64).round() as i64);

        match line_cost {
            Some(line) => toplam += line as f64,
            None => {
                unresolved.push(component_name.clone());
                tamamlandi = false;
            }
        }

        components.push(ComponentCost {
            component_product_id,
            name: component_name,
            quantity: needed,
            unit,
            unit_cost_cents: unit_cost,
            line_cost_cents: line_cost,
            unresolved_reason: if line_cost.is_none() {
                Some("malzeme maliyeti bilinmiyor: reçetesiz ve fiyatsız".into())
            } else {
                None
            },
        });
    }

    visiting.pop();

    let materials_cost_cents = if tamamlandi {
        round_cents(toplam)
    } else {
        None
    };
    let (standard_cost_cents, waste_cost_cents) = match materials_cost_cents {
        Some(materials) => {
            // Randıman yüzdedir: %90 randıman, maliyetin 100/90 katını
            // gerektirir. `materials / yield_percent` yazılırsa 100 kat küçük
            // bir maliyet çıkar (35556 / 90 = 395 yerine 39507 olmalı).
            let tam_verim = (materials as f64) * 100.0 / yield_percent.max(1e-9);
            let waste = (tam_verim - materials as f64).round();
            (Some(tam_verim.round() as i64), round_cents(waste))
        }
        None => (None, None),
    };

    // Birim maliyet standart üretimin tamamından türetilir. Ayrı alanda
    // tutulmasının nedeni: `standard_cost_cents` zaten `output_quantity` adet
    // üretimin maliyetidir, "birim maliyet" diye okunup çarpılırsa maliyet
    // `output_quantity` katı şişer.
    let unit_cost_cents = match (standard_cost_cents, output_quantity) {
        (Some(tam), miktar) if miktar > 0.0 => {
            Some(((tam as f64) / miktar).round() as i64)
        }
        // Çıktı miktarı sıfırsa birim maliyet tanımsızdır: sıfır yazmak maliyeti
        // yok eder.
        _ => None,
    };

    Ok(RecipeCost {
        recipe_id: recipe_id.to_string(),
        product_id,
        product_name,
        output_quantity,
        output_unit,
        yield_percent,
        materials_cost_cents,
        standard_cost_cents,
        unit_cost_cents,
        waste_cost_cents,
        components,
        unresolved,
    })
}

/// Genel amaçlı giriş noktası: standart üretim miktarı için maliyet çözer.
pub async fn cost_for_active_recipe(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
) -> Result<Option<RecipeCost>, String> {
    let recipe_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM recipes WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    match recipe_id {
        Some(id) => {
            // `visiting` **boş** başlar: `calculate_recipe_cost_inner` kendi
            // `product_id`sini ekler. Ürün kimliği burada eklenirse ilk satırda
            // "kendini içeriyor" hatası verir ve fonksiyon hiçbir zaman başarılı
            // olamaz.
            let mut visiting = Vec::new();
            Ok(Some(
                calculate_recipe_cost_inner(conn, tenant_id, &id, &mut visiting, 0).await?,
            ))
        }
        None => Ok(None),
    }
}
