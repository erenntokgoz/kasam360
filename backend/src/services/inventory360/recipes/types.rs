//! Yarı mamul reçete ve maliyet çözümü (Spec §2.12).
//!
//! Neden gerekli: "kruasan" tek başına satılmayan bir yarı mamuldür; un, yağ,
//! maya ve tuzdan yapılır. Reçetesiz satış, ürünün maliyetini ve fireyi
//! görünmez kılar — %35 sabit katsayı AGENTS.md §2 tarafından yasaklanmıştır.
//!
//! Sessizlik yasağı: bir malzemenin maliyeti bilinmiyorsa sonuç **sıfır** değil
//! `bilinmiyor` olur. Reçetesiz ve fiyatsız malzemeyle hesaplanan sahte sıfır
//! maliyet, tüm P&L'i yanlış kılar (AGENTS.md §3.4).

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::optional_text;

/// Bir malzemenin çözülmüş maliyeti. `unit_cost_cents: None` bilinmeyen
/// maliyettir ve sıfırdan farklıdır.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ComponentCost {
    pub component_product_id: String,
    pub name: String,
    pub quantity: f64,
    pub unit: String,
    /// Malzemenin birim maliyeti (kuruş). `None` = kayıt yok.
    pub unit_cost_cents: Option<i64>,
    /// Malzemenin bu miktar için toplam maliyeti (kuruş). `None` = bilinmiyor.
    pub line_cost_cents: Option<i64>,
    /// Maliyeti çözülemedi; reçete eksik malzeme içeriyor.
    pub unresolved_reason: Option<String>,
}

/// Bir ürünün reçete maliyeti dökümü.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RecipeCost {
    pub recipe_id: String,
    pub product_id: String,
    pub product_name: String,
    pub output_quantity: f64,
    pub output_unit: String,
    pub yield_percent: f64,
    /// Malzeme maliyetlerinin toplamı (kuruş). `None` = en az bir malzeme
    /// çözülemedi.
    pub materials_cost_cents: Option<i64>,
    /// `output_quantity` adet üretimin **toplam** maliyeti (kuruş): malzeme
    /// toplamı randıman ve fire payıyla düzeltilmiş hâli.
    ///
    /// Neden ayrı alan: bu değer birim değildir. Adı "birim maliyet" olsaydı ekran
    /// `output_quantity` ile çarpıp maliyeti şişirirdi. Birim maliyet
    /// `unit_cost_cents` alanındadır ve buradan türetilir.
    pub standard_cost_cents: Option<i64>,
    /// Üretilen **bir** birimin maliyeti (kuruş):
    /// `standard_cost_cents / output_quantity`. `None` = maliyet bilinmiyor.
    pub unit_cost_cents: Option<i64>,
    /// Üretim kaybının tutarı (kuruş). Randıman %80 ise üretilen her birim için
    /// %20 kayıp maliyeti içerir; bu tutar P&L'de görünmelidir.
    pub waste_cost_cents: Option<i64>,
    pub components: Vec<ComponentCost>,
    /// Maliyeti çözülemeyen malzemeler. Rapor "maliyeti bilinmiyor" der.
    pub unresolved: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RecipeItem {
    pub id: String,
    pub component_product_id: String,
    pub component_name: String,
    pub is_sub_recipe: bool,
    pub quantity: f64,
    pub unit: String,
    pub waste_percent: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Recipe {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub name: String,
    pub yield_percent: f64,
    pub output_quantity: f64,
    pub output_unit: String,
    pub is_active: bool,
    pub version: i64,
    pub notes: Option<String>,
    pub items: Vec<RecipeItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeItemInput {
    pub component_product_id: String,
    pub quantity: f64,
    pub unit: String,
    pub waste_percent: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInput {
    pub product_id: String,
    pub name: String,
    pub yield_percent: f64,
    pub output_quantity: f64,
    pub output_unit: String,
    pub notes: Option<String>,
    pub items: Vec<RecipeItemInput>,
}

/// Reçete derinlik sınırı. Alt yarı mamul zinciri (kruasan → hamur → un → hamur)
/// döngüsel tanımlanabilir; sınır sonsuz özyinelemenin veritabanını kilitlemesini
/// engeller ve hatayı yukarı taşır.
pub(super) const MAX_RECIPE_DEPTH: usize = 8;

pub(super) fn round_cents(value: f64) -> Option<i64> {
    if !value.is_finite() {
        return None;
    }
    Some(value.round() as i64)
}

pub async fn list_recipes(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    include_inactive: bool,
) -> Result<Vec<Recipe>, String> {
    let sql = if include_inactive {
        "SELECT r.id, r.product_id, p.name AS product_name, r.name, r.yield_percent,
                r.output_quantity, r.output_unit, r.is_active, r.version, r.notes
           FROM recipes r
           JOIN products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id
          WHERE r.tenant_id = ?
          ORDER BY r.is_active DESC, p.name ASC"
    } else {
        "SELECT r.id, r.product_id, p.name AS product_name, r.name, r.yield_percent,
                r.output_quantity, r.output_unit, r.is_active, r.version, r.notes
           FROM recipes r
           JOIN products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id
          WHERE r.tenant_id = ? AND r.is_active = 1
          ORDER BY p.name ASC"
    };

    let rows = sqlx::query(sql)
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        result.push(Recipe {
            id: id.clone(),
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            yield_percent: row.try_get("yield_percent").map_err(|e| e.to_string())?,
            output_quantity: row.try_get("output_quantity").map_err(|e| e.to_string())?,
            output_unit: row.try_get("output_unit").map_err(|e| e.to_string())?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
            version: row.try_get("version").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
            items: load_items(conn, tenant_id, &id).await?,
        });
    }
    Ok(result)
}

pub(super) async fn load_items(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_id: &str,
) -> Result<Vec<RecipeItem>, String> {
    let rows = sqlx::query(
        "SELECT ri.id, ri.component_product_id, p.name AS component_name,
                ri.is_sub_recipe, ri.quantity, ri.unit, ri.waste_percent, ri.notes
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

    let mut items = Vec::new();
    for row in rows {
        items.push(RecipeItem {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            component_product_id: row
                .try_get("component_product_id")
                .map_err(|e| e.to_string())?,
            component_name: row.try_get("component_name").map_err(|e| e.to_string())?,
            is_sub_recipe: row.try_get("is_sub_recipe").map_err(|e| e.to_string())?,
            quantity: row.try_get("quantity").map_err(|e| e.to_string())?,
            unit: row.try_get("unit").map_err(|e| e.to_string())?,
            waste_percent: row.try_get("waste_percent").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
        });
    }
    Ok(items)
}

/// Reçete oluşturur. Aynı ürün için ikinci bir **aktif** reçete kabul edilmez:
/// iki aktif reçete maliyeti belirsizleştirir ve hangisinin uygulandığı
/// bilinemez. Kısmi benzersiz indeks veritabanında da bunu garanti eder.
pub async fn create_recipe(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: RecipeInput,
) -> Result<Recipe, String> {
    ensure_owned(conn, "products", &input.product_id, tenant_id).await?;

    if !(input.yield_percent.is_finite()
        && input.yield_percent > 0.0
        && input.yield_percent <= 100.0)
    {
        return Err("VALIDATION: randıman 0-100 arasında olmalı".into());
    }
    if !(input.output_quantity.is_finite() && input.output_quantity > 0.0) {
        return Err("VALIDATION: standart üretim miktarı sıfırdan büyük olmalı".into());
    }
    if input.items.is_empty() {
        return Err("VALIDATION: reçete en az bir malzeme içermeli".into());
    }

    let aktif: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM recipes WHERE tenant_id = ? AND product_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(&input.product_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if aktif.unwrap_or(0) > 0 {
        return Err(format!(
            "CONFLICT: bu ürün için aktif reçete zaten var, önce mevcut reçeteyi pasife al"
        ));
    }

    // Bütün kalemler **önce** doğrulanır. Doğrulama INSERT'ten sonra
    // yapılırsa reddedilen bir reçete yarım kalmış olur: `recipes` satırı
    // yazılır, kalem yazılamaz ve ürün "aktif reçetesi var" durumuna düşer.
    // Böylece kullanıcı hatayı düzeltip yeniden denediğinde "zaten aktif
    // reçete var" hatası alır ve reçeteyi hiçbir zaman oluşturamaz.
    let mut waste_oranlari: Vec<f64> = Vec::with_capacity(input.items.len());
    for item in &input.items {
        ensure_owned(conn, "products", &item.component_product_id, tenant_id).await?;
        if item.component_product_id == input.product_id {
            return Err("VALIDATION: reçete kendi ürününü malzeme olarak içeremez".into());
        }
        let waste = item.waste_percent.unwrap_or(0.0);
        if !(waste.is_finite() && (0.0..100.0).contains(&waste)) {
            return Err("VALIDATION: fire payı 0-100 arasında olmalı".into());
        }
        if !(item.quantity.is_finite() && item.quantity > 0.0) {
            return Err("VALIDATION: malzeme miktarı sıfırdan büyük olmalı".into());
        }
        waste_oranlari.push(waste);
    }

    let id = generate_id("rcp");
    sqlx::query(
        "INSERT INTO recipes
             (id, tenant_id, product_id, name, yield_percent, output_quantity,
              output_unit, is_active, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.product_id)
    .bind(&input.name)
    .bind(input.yield_percent)
    .bind(input.output_quantity)
    .bind(&input.output_unit)
    .bind(&input.notes)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for (item, waste) in input.items.iter().zip(waste_oranlari.iter().copied()) {
        sqlx::query(
            "INSERT INTO recipe_items
                 (id, tenant_id, recipe_id, component_product_id, is_sub_recipe,
                  quantity, unit, waste_percent, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(generate_id("rit"))
        .bind(tenant_id)
        .bind(&id)
        .bind(&item.component_product_id)
        .bind(false)
        .bind(item.quantity)
        .bind(&item.unit)
        .bind(waste)
        .bind(&item.notes)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    let items = load_items(conn, tenant_id, &id).await?;
    let product_name: String =
        sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
            .bind(&input.product_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;

    Ok(Recipe {
        id,
        product_id: input.product_id,
        product_name,
        name: input.name,
        yield_percent: input.yield_percent,
        output_quantity: input.output_quantity,
        output_unit: input.output_unit,
        is_active: true,
        version: 1,
        notes: input.notes,
        items,
    })
}

/// Reçeteyi pasife alır. Silinmez: geçmiş maliyet hesapları bu kaydı referans
/// alır ve reçeteyi silmek o hesapları geriye dönük bozardı (AGENTS.md §2,
/// audit_ledger değişmezliğiyle aynı ilke).
pub async fn deactivate_recipe(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_id: &str,
) -> Result<(), String> {
    ensure_owned(conn, "recipes", recipe_id, tenant_id).await?;
    sqlx::query(
        "UPDATE recipes SET is_active = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(recipe_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
