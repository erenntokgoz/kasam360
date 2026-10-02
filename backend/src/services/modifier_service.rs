//! Modifier (seçenek & ekstra) altyapısı.
//!
//! Neden ayrı servis: modifier mantığı üç ayrı komutta dağınık haldeydi ve
//! üçünde de aynı iki açık vardı — (1) `modifier_groups` tenant filtresi
//! olmadan okunuyor/ siliniyordu, (2) seçenek fiyatı sipariş anında istemciden
//! geliyordu. Bu servis kuralları tek yerde toplar; komutlar yalnız RBAC ve
//! audit kaydı için ince bir katman kalır.
//!
//! Veri modeli değişmedi: `modifier_groups` + `modifier_options` +
//! `product_modifier_groups`. Kategori şablonu için **yeni tablo açılmadı**;
//! `modifier_groups.category_id` nullable kolonu kullanılır (`NULL` = serbest
//! grup, dolu = o kategorinin şablonu). Mevcut satırlar `NULL` kalır, dolayısıyla
//! hiçbir mevcut veri taşınmaz.

use sqlx::{Row, SqliteConnection};

use crate::id_generator;

/// Bir sipariş kaleminde kabul edilen azami seçenek sayısı. Sınır aşımı hata
/// üretir; fiyat hesabı kısmen yapılmaz.
pub const MAX_OPTIONS_PER_ITEM: usize = 20;

/// Seçenek fiyat farkı (kuruş). Ürün temel fiyatından ayrı tutulur.
#[derive(Debug, serde::Deserialize, serde::Serialize, Clone, PartialEq, Eq)]
pub struct ModifierOptionDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "priceCents")]
    pub price_cents: i64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct ModifierGroupDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "isRequired")]
    pub is_required: bool,
    #[serde(rename = "minSelections")]
    pub min_selections: i64,
    #[serde(rename = "maxSelections")]
    pub max_selections: Option<i64>,
    /// Şablonun bağlı olduğu kategori. `None` ise grup serbesttir (bir ürüne
    /// doğrudan atanır).
    #[serde(rename = "categoryId")]
    pub category_id: Option<String>,
    pub options: Vec<ModifierOptionDto>,
}

/// Negatif fiyat farkı bir veri hatasıdır; ekstra indirim olamaz.
fn validate_option_price(price_cents: i64) -> Result<(), String> {
    if price_cents < 0 {
        return Err(
            "INVALID_MODIFIER_PRICE: Seçenek fiyat farkı negatif olamaz.".to_string(),
        );
    }
    Ok(())
}

fn row_to_group(row: &sqlx::sqlite::SqliteRow, options: Vec<ModifierOptionDto>) -> ModifierGroupDto {
    ModifierGroupDto {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        is_required: row.try_get("is_required").unwrap_or(false),
        min_selections: row.try_get("min_selections").unwrap_or(0),
        max_selections: row.try_get("max_selections").ok().flatten(),
        category_id: row.try_get("category_id").ok().flatten(),
        options,
    }
}

async fn options_of(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    group_ids: &[String],
) -> Result<Vec<(String, ModifierOptionDto)>, String> {
    if group_ids.is_empty() {
        return Ok(Vec::new());
    }
    // `group_id IN (...)` ile tek sorgu: grup başına N+1 sorgu yapılmaz.
    // `modifier_options`ın kendi `tenant_id` kolonu yoktur; sahiplik grup
    // üzerinden **sorgunun kendi içinde** doğrulanır (derinlik savunması).
    let placeholders = std::iter::repeat("?")
        .take(group_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT mo.group_id, mo.id, mo.name, mo.price_cents FROM modifier_options mo \
         JOIN modifier_groups mg ON mg.id = mo.group_id \
         WHERE mo.group_id IN ({}) AND mg.tenant_id = ? ORDER BY mo.name ASC",
        placeholders
    );

    let mut query = sqlx::query(&sql);
    for id in group_ids {
        query = query.bind(id);
    }
    query = query.bind(tenant_id);
    let rows = query.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push((
            row.try_get::<String, _>("group_id").unwrap_or_default(),
            ModifierOptionDto {
                id: row.try_get("id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                price_cents: row.try_get("price_cents").unwrap_or(0),
            },
        ));
    }
    Ok(out)
}

/// Tenant'ın tüm modifier grupları. `category_id` filtresi verilirse yalnız o
/// kategorinin şablonları döner.
pub async fn list_groups(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    category_id: Option<&str>,
) -> Result<Vec<ModifierGroupDto>, String> {
    let rows = match category_id {
        Some(cid) => {
            sqlx::query(
                "SELECT id, name, is_required, min_selections, max_selections, category_id \
                 FROM modifier_groups WHERE tenant_id = ? AND category_id = ? ORDER BY name ASC",
            )
            .bind(tenant_id)
            .bind(cid)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query(
                "SELECT id, name, is_required, min_selections, max_selections, category_id \
                 FROM modifier_groups WHERE tenant_id = ? ORDER BY name ASC",
            )
            .bind(tenant_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
        }
    };

    let ids: Vec<String> = rows
        .iter()
        .map(|r| r.try_get::<String, _>("id").unwrap_or_default())
        .collect();
    let flat_options = options_of(conn, tenant_id, &ids).await?;

    Ok(rows
        .iter()
        .map(|row| {
            let group_id = row.try_get::<String, _>("id").unwrap_or_default();
            let options = flat_options
                .iter()
                .filter(|(gid, _)| *gid == group_id)
                .map(|(_, opt)| opt.clone())
                .collect();
            row_to_group(row, options)
        })
        .collect())
}

/// Yeni grup. `category_id` verilirse bu grup o kategorinin şablonu olur.
pub async fn create_group(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    name: &str,
    is_required: bool,
    min_selections: i64,
    max_selections: Option<i64>,
    category_id: Option<&str>,
) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("INVALID_MODIFIER_GROUP: Grup adı boş olamaz.".to_string());
    }
    if let Some(cid) = category_id {
        ensure_category_in_tenant(conn, tenant_id, cid).await?;
    }

    let id = id_generator::generate_id("mod");
    sqlx::query(
        "INSERT INTO modifier_groups (id, tenant_id, name, is_required, min_selections, max_selections, category_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(trimmed)
    .bind(is_required)
    .bind(min_selections)
    .bind(max_selections)
    .bind(category_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Gruba seçenek ekler. Grup çağıranın tenant'ına ait olmak zorundadır.
pub async fn add_option(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    group_id: &str,
    name: &str,
    price_cents: i64,
) -> Result<String, String> {
    validate_option_price(price_cents)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("INVALID_MODIFIER_OPTION: Seçenek adı boş olamaz.".to_string());
    }
    ensure_group_in_tenant(conn, tenant_id, group_id).await?;

    let id = id_generator::generate_id("mod");
    sqlx::query(
        "INSERT INTO modifier_options (id, group_id, name, price_cents) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(group_id)
    .bind(trimmed)
    .bind(price_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Grubu siler. Silinen grubun adı audit kaydı için döner.
/// Yalnız çağıranın tenant'ındaki grup silinebilir.
pub async fn delete_group(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    group_id: &str,
) -> Result<Option<String>, String> {
    let previous_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM modifier_groups WHERE id = ? AND tenant_id = ?")
            .bind(group_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    if previous_name.is_none() {
        return Err("NOT_FOUND: Modifier grubu bulunamadı.".to_string());
    }

    // `modifier_options` ve `product_modifier_groups` FK'si `ON DELETE CASCADE`
    // ile bağlı; SQLite bu kuralı yalnız `PRAGMA foreign_keys = ON` iken uygular.
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM modifier_groups WHERE id = ? AND tenant_id = ?")
        .bind(group_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(previous_name)
}

/// Ürünün bağlı olduğu grupları **değiştirir** (küme semantiği).
///
/// Neden `set` ve `append`: seçim kutusu "bu gruplar seçili" bilgisinin tamamını
/// gönderir; kısmi ekleme yarım kalmış atamalar bırakır.
pub async fn set_product_groups(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    group_ids: &[String],
) -> Result<(), String> {
    ensure_product_in_tenant(conn, tenant_id, product_id).await?;

    // Atanacak her grup çağıranın tenant'ında olmalı; aksi hâlde başka
    // işletmenin grubu ürüne bağlanabilirdi.
    for gid in group_ids {
        ensure_group_in_tenant(conn, tenant_id, gid).await?;
    }

    sqlx::query("DELETE FROM product_modifier_groups WHERE product_id = ?")
        .bind(product_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    for gid in group_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id) VALUES (?, ?)",
        )
        .bind(product_id)
        .bind(gid)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub async fn product_group_ids(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
) -> Result<Vec<String>, String> {
    ensure_product_in_tenant(conn, tenant_id, product_id).await?;

    let rows = sqlx::query(
        "SELECT pmg.group_id FROM product_modifier_groups pmg \
         JOIN modifier_groups mg ON mg.id = pmg.group_id \
         WHERE pmg.product_id = ? AND mg.tenant_id = ? \
         ORDER BY mg.name ASC",
    )
    .bind(product_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| r.try_get::<String, _>("group_id").unwrap_or_default())
        .collect())
}

/// POS'un kullandığı görünüm: ürüne bağlı gruplar + seçenekleri.
pub async fn product_groups(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
) -> Result<Vec<ModifierGroupDto>, String> {
    ensure_product_in_tenant(conn, tenant_id, product_id).await?;

    let rows = sqlx::query(
        "SELECT mg.id, mg.name, mg.is_required, mg.min_selections, mg.max_selections, mg.category_id \
         FROM modifier_groups mg \
         JOIN product_modifier_groups pmg ON mg.id = pmg.group_id \
         WHERE pmg.product_id = ? AND mg.tenant_id = ? \
         ORDER BY mg.name ASC",
    )
    .bind(product_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let ids: Vec<String> = rows
        .iter()
        .map(|r| r.try_get::<String, _>("id").unwrap_or_default())
        .collect();
    let flat_options = options_of(conn, tenant_id, &ids).await?;

    Ok(rows
        .iter()
        .map(|row| {
            let group_id = row.try_get::<String, _>("id").unwrap_or_default();
            let options = flat_options
                .iter()
                .filter(|(gid, _)| *gid == group_id)
                .map(|(_, opt)| opt.clone())
                .collect();
            row_to_group(row, options)
        })
        .collect())
}

/// Seçilen seçeneklerin **veritabanı** fiyat farkı toplamı.
///
/// Neden istemcideki `priceCents` kullanılmıyor: fiyat istemciden gelirse
/// ekstre ücreti `0` gönderilerek ödenebilir. Ödeme gerçeği her zaman
/// sunucuda, bu fonksiyondan türetilir. Kimliği bulunamayan seçenek reddedilir
/// (fail-closed): sessizce `0` fiyatlamak para kaybıdır.
pub async fn sum_selected_option_prices(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    modifiers: Option<&serde_json::Value>,
) -> Result<i64, String> {
    let arr = match modifiers.and_then(|m| m.as_array()) {
        Some(a) => a,
        None => return Ok(0),
    };

    // Sınır: kalem başına bu kadar seçenek makul; üstü hem istemci hatası hem
    // deneme (her seçenek için sorgu) anlamına gelir. Sınır aşılırsa sessizce
    // ödemek yerine hata verilir — fail-closed.
    if arr.len() > MAX_OPTIONS_PER_ITEM {
        return Err(format!(
            "INVALID_MODIFIER_SELECTION: Kalem başına en fazla {} seçenek seçilebilir.",
            MAX_OPTIONS_PER_ITEM
        ));
    }

    let mut total = 0i64;
    for entry in arr {
        let option_id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "MALICIOUS_INPUT: Seçenek kimliği eksik.".to_string())?;

        let price: Option<i64> = sqlx::query_scalar(
            "SELECT mo.price_cents FROM modifier_options mo \
             JOIN modifier_groups mg ON mg.id = mo.group_id \
             WHERE mo.id = ? AND mg.tenant_id = ?",
        )
        .bind(option_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .map(|v: i64| v);

        let price = price.ok_or_else(|| {
            "MALICIOUS_INPUT: Seçenek bu işletmeye ait değil veya silinmiş.".to_string()
        })?;
        total += price;
    }

    Ok(total)
}

/// Sipariş kalemi için **sunucu otoritesinde** birim fiyat: ürünün kendi
/// fiyatı + seçilen seçeneklerin veritabanı fiyatları.
///
/// `frozen_unit_price_cents` verilirse (siparişte dondurulmuş fiyat) onun
/// üzerine modifier **eklenmez**: dondurulmuş fiyat zaten modifier'ı içerir.
/// Eklenirse aynı ekstra iki kez ücretlenir.
pub async fn resolve_unit_price(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_row: (i64, f64),
    modifiers: Option<&serde_json::Value>,
    frozen_unit_price_cents: Option<i64>,
) -> Result<i64, String> {
    if let Some(frozen) = frozen_unit_price_cents {
        return Ok(frozen);
    }
    let (product_price_cents, _) = product_row;
    let extras = sum_selected_option_prices(conn, tenant_id, modifiers).await?;
    Ok(product_price_cents + extras)
}

async fn ensure_group_in_tenant(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    group_id: &str,
) -> Result<(), String> {
    let owner: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM modifier_groups WHERE id = ?")
            .bind(group_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    match owner {
        Some(t) if t == tenant_id => Ok(()),
        Some(_) => Err("TENANT_ISOLATION: Bu modifier grubu başka işletmeye ait.".to_string()),
        None => Err("NOT_FOUND: Modifier grubu bulunamadı.".to_string()),
    }
}

async fn ensure_product_in_tenant(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
) -> Result<(), String> {
    let owner: Option<String> = sqlx::query_scalar("SELECT tenant_id FROM products WHERE id = ?")
        .bind(product_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    match owner {
        Some(t) if t == tenant_id => Ok(()),
        Some(_) => Err("TENANT_ISOLATION: Bu ürün başka işletmeye ait.".to_string()),
        None => Err("NOT_FOUND: Ürün bulunamadı.".to_string()),
    }
}

async fn ensure_category_in_tenant(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    category_id: &str,
) -> Result<(), String> {
    let owner: Option<String> = sqlx::query_scalar("SELECT tenant_id FROM categories WHERE id = ?")
        .bind(category_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    match owner {
        Some(t) if t == tenant_id => Ok(()),
        Some(_) => Err("TENANT_ISOLATION: Bu kategori başka işletmeye ait.".to_string()),
        None => Err("NOT_FOUND: Kategori bulunamadı.".to_string()),
    }
}

#[cfg(test)]
#[path = "modifier_service_tests.rs"]
mod tests;
