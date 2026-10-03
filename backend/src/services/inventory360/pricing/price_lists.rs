use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::optional_text;

// ---------------------------------------------------------------------------
// FİYAT LİSTELERİ
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PriceListItem {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub price_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PriceList {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: bool,
    pub items: Vec<PriceListItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceListItemInput {
    pub product_id: String,
    pub price_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceListInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: Option<bool>,
    /// Liste kalemleri. Boş bırakılırsa liste kalemsiz oluşturulur; kasada
    /// fiyat listesi seçildiğinde çözümleme ürün fiyatına düşer.
    pub items: Option<Vec<PriceListItemInput>>,
}

const GECERLI_LISTE_TURLERI: [&str; 3] = ["PERAKENDE", "TOPTAN", "KAMPANYA"];

pub async fn create_price_list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    mut input: PriceListInput,
) -> Result<PriceList, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: fiyat listesi adı boş olamaz".into());
    }
    let kind = input.kind.unwrap_or_else(|| "PERAKENDE".to_string());
    if !GECERLI_LISTE_TURLERI.contains(&kind.as_str()) {
        return Err(format!(
            "VALIDATION: fiyat listesi türü geçersiz, izin verilenler: {}",
            GECERLI_LISTE_TURLERI.join(", ")
        ));
    }
    if let (Some(from), Some(to)) = (input.valid_from.as_deref(), input.valid_to.as_deref()) {
        if to < from {
            return Err("VALIDATION: bitiş tarihi başlangıçtan önce olamaz".into());
        }
    }

    // Kalem doğrulaması başlıktan **önce** yapılır: negatif fiyatlı bir kalem
    // reddedildiğinde kalemsiz bir fiyat listesi kasada seçilip boş fiyat
    // döndürebilirdi. Doğrulama yazmadan önce bitmeli; çağıran komut ayrıca
    // `BEGIN IMMEDIATE` ile sarar.
    let kalemler = input.items.take().unwrap_or_default();
    let mut hazirlanan: Vec<(String, i64, String)> = Vec::with_capacity(kalemler.len());
    for kalem in &kalemler {
        if kalem.price_cents < 0 {
            return Err("VALIDATION: fiyat listesi fiyatı negatif olamaz".into());
        }
        ensure_owned(conn, "products", &kalem.product_id, tenant_id).await?;

        let product_name: String =
            sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
                .bind(&kalem.product_id)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;
        hazirlanan.push((kalem.product_id.clone(), kalem.price_cents, product_name));
    }

    let id = generate_id("pls");
    sqlx::query(
        "INSERT INTO price_lists
             (id, tenant_id, name, kind, valid_from, valid_to, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(name)
    .bind(&kind)
    .bind(&input.valid_from)
    .bind(&input.valid_to)
    .bind(input.is_active.unwrap_or(true))
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut kaydedilen = Vec::with_capacity(hazirlanan.len());
    for (product_id, price_cents, product_name) in &hazirlanan {
        sqlx::query(
            "INSERT INTO price_list_items (id, tenant_id, price_list_id, product_id, price_cents)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(generate_id("pli"))
        .bind(tenant_id)
        .bind(&id)
        .bind(product_id)
        .bind(price_cents)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        kaydedilen.push(PriceListItem {
            id: product_id.clone(),
            product_id: product_id.clone(),
            product_name: product_name.clone(),
            price_cents: *price_cents,
        });
    }

    let liste = PriceList {
        id,
        name: name.to_string(),
        kind,
        valid_from: input.valid_from,
        valid_to: input.valid_to,
        is_active: input.is_active.unwrap_or(true),
        items: kaydedilen,
    };
    Ok(liste)
}

pub async fn delete_price_list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<(), String> {
    ensure_owned(conn, "price_lists", id, tenant_id).await?;
    sqlx::query("DELETE FROM price_lists WHERE id = ? AND tenant_id = ?")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn list_price_lists(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<PriceList>, String> {
    let rows = sqlx::query(
        "SELECT id, name, kind, valid_from, valid_to, is_active
           FROM price_lists
          WHERE tenant_id = ?
          ORDER BY is_active DESC, name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        result.push(PriceList {
            id: id.clone(),
            name: row.try_get("name").map_err(|e| e.to_string())?,
            kind: row.try_get("kind").map_err(|e| e.to_string())?,
            valid_from: optional_text(&row, "valid_from")?,
            valid_to: optional_text(&row, "valid_to")?,
            is_active: row.try_get("is_active").map_err(|e| e.to_string())?,
            items: load_price_list_items(conn, tenant_id, &id).await?,
        });
    }
    Ok(result)
}

async fn load_price_list_items(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    price_list_id: &str,
) -> Result<Vec<PriceListItem>, String> {
    let rows = sqlx::query(
        "SELECT pli.id, pli.product_id, p.name AS product_name, pli.price_cents
           FROM price_list_items pli
           JOIN products p ON p.id = pli.product_id AND p.tenant_id = pli.tenant_id
          WHERE pli.tenant_id = ? AND pli.price_list_id = ?
          ORDER BY p.name ASC",
    )
    .bind(tenant_id)
    .bind(price_list_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(PriceListItem {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            price_cents: row.try_get("price_cents").map_err(|e| e.to_string())?,
        });
    }
    Ok(items)
}
