use super::types::{ComponentCost, RecipeCost, MAX_RECIPE_DEPTH};
use sqlx::{Row, SqliteConnection};

const QUANTITY_SCALE: i128 = 1_000_000;

fn quantity_micros(quantity: f64) -> Result<i128, String> {
    if !quantity.is_finite() || quantity <= 0.0 || quantity > (i64::MAX as f64) / 1_000_000.0 {
        return Err("VALIDATION: geçersiz stok miktarı".into());
    }
    let micros = (quantity * QUANTITY_SCALE as f64).round() as i128;
    if micros == 0 {
        return Err("VALIDATION: stok miktarı ölçülemeyecek kadar küçük".into());
    }
    Ok(micros)
}

fn rounded_cents(numerator: i128, denominator: i128) -> Result<i64, String> {
    let rounded = numerator
        .checked_add(denominator / 2)
        .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?
        / denominator;
    i64::try_from(rounded).map_err(|_| "OVERFLOW: maliyet hesaplaması taştı".to_string())
}

/// Malzemenin birim maliyetini çözer.
///
/// Öncelik sırası:
///   1. Alt yarı mamul reçetesi varsa reçetenin birim maliyeti (özyinelemeli).
///   2. Stok partilerinden gereken miktarın FIFO maliyeti.
///
/// Biri de yoksa None döner — sıfır değil.
pub(super) async fn resolve_component_cost(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    visiting: &mut Vec<String>,
    depth: usize,
    quantity: f64,
) -> Result<Option<(i64, i64)>, String> {
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

    let needed_micros = quantity_micros(quantity)?;
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
            match ic.standard_cost_cents {
                Some(total) => {
                    let output_micros = quantity_micros(output_quantity)?;
                    let numerator = i128::from(total)
                        .checked_mul(needed_micros)
                        .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
                    let line = rounded_cents(numerator, output_micros)?;
                    let unit = rounded_cents(i128::from(total) * QUANTITY_SCALE, output_micros)?;
                    Some((unit, line))
                }
                None => None,
            }
        }
        None => {
            // Reçete okuması stoğu tüketmez; aynı FIFO sırasıyla maliyeti
            // hesaplar. Parti yetmezse teklif fiyatı stok maliyeti sayılmaz.
            let batches = sqlx::query(
                "SELECT remaining_quantity, unit_cost_cents FROM inventory_batches
                  WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
                  ORDER BY received_at ASC, id ASC",
            )
            .bind(tenant_id)
            .bind(product_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            let mut remaining = needed_micros;
            let mut cost_micros = 0_i128;
            for batch in batches {
                let available: f64 = batch
                    .try_get("remaining_quantity")
                    .map_err(|e| e.to_string())?;
                let unit_cost: i64 = batch
                    .try_get("unit_cost_cents")
                    .map_err(|e| e.to_string())?;
                if unit_cost < 0 {
                    return Err("VALIDATION: negatif parti maliyeti".into());
                }
                let consumed = remaining.min(quantity_micros(available)?);
                cost_micros = cost_micros
                    .checked_add(
                        consumed
                            .checked_mul(i128::from(unit_cost))
                            .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?,
                    )
                    .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
                remaining -= consumed;
                if remaining == 0 {
                    break;
                }
            }
            if remaining > 0 {
                None
            } else {
                Some((
                    rounded_cents(cost_micros, needed_micros)?,
                    rounded_cents(cost_micros, QUANTITY_SCALE)?,
                ))
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
    let mut toplam: i64 = 0;
    let mut tamamlandi = true;

    for row in item_rows {
        let component_product_id: String = row
            .try_get("component_product_id")
            .map_err(|e| e.to_string())?;
        let component_name: String = row.try_get("component_name").map_err(|e| e.to_string())?;
        let quantity: f64 = row.try_get("quantity").map_err(|e| e.to_string())?;
        let unit: String = row.try_get("unit").map_err(|e| e.to_string())?;
        let waste_percent: f64 = row.try_get("waste_percent").map_err(|e| e.to_string())?;

        // Fire payı malzeme ihtiyacını büyütür: %10 fire varsa 1 birim üretim
        // için 1 / (1 - 0.10) = 1.111 birim malzeme harcanır.
        let needed = quantity / (1.0 - waste_percent / 100.0);
        let cost = resolve_component_cost(
            conn,
            tenant_id,
            &component_product_id,
            visiting,
            depth + 1,
            needed,
        )
        .await?;
        let unit_cost = cost.map(|(unit, _)| unit);
        let line_cost = cost.map(|(_, line)| line);

        match line_cost {
            Some(line) => {
                toplam = toplam
                    .checked_add(line)
                    .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
            }
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

    let materials_cost_cents = if tamamlandi { Some(toplam) } else { None };
    let (standard_cost_cents, waste_cost_cents) = match materials_cost_cents {
        Some(materials) => {
            // Randıman yüzdedir: %90 randıman, maliyetin 100/90 katını
            // gerektirir. `materials / yield_percent` yazılırsa 100 kat küçük
            // bir maliyet çıkar (35556 / 90 = 395 yerine 39507 olmalı).
            let yield_basis_points = (yield_percent * 100.0).round() as i128;
            if yield_basis_points <= 0 {
                return Err("VALIDATION: geçersiz randıman".into());
            }
            let numerator = i128::from(materials)
                .checked_mul(10_000)
                .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
            let standard = rounded_cents(numerator, yield_basis_points)?;
            let waste = standard
                .checked_sub(materials)
                .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
            (Some(standard), Some(waste))
        }
        None => (None, None),
    };

    // Birim maliyet standart üretimin tamamından türetilir. Ayrı alanda
    // tutulmasının nedeni: `standard_cost_cents` zaten `output_quantity` adet
    // üretimin maliyetidir, "birim maliyet" diye okunup çarpılırsa maliyet
    // `output_quantity` katı şişer.
    let unit_cost_cents = match (standard_cost_cents, output_quantity) {
        (Some(tam), miktar) if miktar > 0.0 => {
            let numerator = i128::from(tam)
                .checked_mul(QUANTITY_SCALE)
                .ok_or_else(|| "OVERFLOW: maliyet hesaplaması taştı".to_string())?;
            Some(rounded_cents(numerator, quantity_micros(miktar)?)?)
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
