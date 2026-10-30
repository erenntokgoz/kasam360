//! POS katalog ve ürün sorgulama komutları.
//!
//! Neden ayrı modül: pos_commands.rs 500 satır tavanını aştığı için
//! ürün ve kategori sorguları bu alt modüle ayrıldı.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosCategoryDto {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosProductDto {
    pub id: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    #[serde(rename = "priceCents", alias = "price_cents")]
    pub price_cents: i64,
    #[serde(rename = "taxRateBp", alias = "tax_rate_bp")]
    pub tax_rate_bp: i64,
    pub category: String,
    #[serde(rename = "categoryId", alias = "category_id")]
    pub category_id: String,
    pub station: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "inStock", alias = "in_stock")]
    pub in_stock: bool,
    #[serde(rename = "stockQuantity", alias = "stock_quantity")]
    pub stock_quantity: Option<f64>,
    pub color: Option<String>,
    #[serde(rename = "imageUrl", alias = "image_url")]
    pub image_url: Option<String>,
    #[serde(rename = "is86", alias = "is_86", default)]
    pub is_86: bool,
    #[serde(rename = "stockoutReason", alias = "stockout_reason")]
    pub stockout_reason: Option<String>,
}

#[tauri::command]
pub async fn pos_get_categories(
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<PosCategoryDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT id, name, icon FROM categories WHERE tenant_id = ? ORDER BY display_order ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for row in rows {
        res.push(PosCategoryDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            icon: row.try_get("icon").ok(),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn pos_get_products(
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<PosProductDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    list_pos_products(&mut conn, &tenant_id).await
}

pub(crate) async fn list_pos_products(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<PosProductDto>, String> {
    if tenant_id.trim().is_empty() {
        return Err("UNAUTHORIZED: işletme kimliği gerekli".into());
    }
    let rows = sqlx::query(
        "SELECT p.id, p.sku, p.barcode, p.name, p.price_cents, p.tax_rate_bp, \
                c.name as category_name, p.category_id, c.default_station, p.description, \
                p.color, p.image_url, p.is_active, p.is_86, p.stockout_reason, \
                CAST(COALESCE(b.current_stock, 0) AS REAL) AS current_stock, \
                COALESCE(b.batch_count, 0) AS batch_count \
         FROM products p \
         JOIN categories c ON p.category_id = c.id AND c.tenant_id = p.tenant_id \
         LEFT JOIN (SELECT tenant_id, product_id, SUM(remaining_quantity) AS current_stock, \
                           COUNT(*) AS batch_count FROM inventory_batches \
                    WHERE product_id IS NOT NULL GROUP BY tenant_id, product_id) b \
           ON b.product_id = p.id AND b.tenant_id = p.tenant_id \
         WHERE p.tenant_id = ? \
         ORDER BY p.name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for row in rows {
        let is_active: bool = row.try_get("is_active").map_err(|e| e.to_string())?;
        let is_86: bool = row.try_get("is_86").map_err(|e| e.to_string())?;
        let stockout_reason: Option<String> =
            row.try_get("stockout_reason").map_err(|e| e.to_string())?;
        let tracked: i64 = row.try_get("batch_count").map_err(|e| e.to_string())?;
        let current_stock: f64 = row.try_get("current_stock").map_err(|e| e.to_string())?;

        res.push(PosProductDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            sku: row.try_get("sku").unwrap_or_default(),
            barcode: row.try_get("barcode").ok(),
            name: row.try_get("name").map_err(|e| e.to_string())?,
            price_cents: row.try_get("price_cents").map_err(|e| e.to_string())?,
            tax_rate_bp: row.try_get("tax_rate_bp").unwrap_or(1000),
            category: row.try_get("category_name").map_err(|e| e.to_string())?,
            category_id: row.try_get("category_id").map_err(|e| e.to_string())?,
            station: row.try_get("default_station").map_err(|e| e.to_string())?,
            description: row.try_get("description").ok(),
            in_stock: is_active && !is_86 && (tracked == 0 || current_stock > 0.0),
            stock_quantity: if tracked > 0 {
                Some(current_stock)
            } else {
                None
            },
            color: row.try_get("color").ok(),
            image_url: row.try_get("image_url").ok(),
            is_86,
            stockout_reason,
        });
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::list_pos_products;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn pos_stogu_partilerden_okur_ve_tukenince_urunu_kapatir() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ('cat_a', 'ten_a', 'A'), ('cat_b', 'ten_b', 'B')")
            .execute(&mut *conn).await.unwrap();
        sqlx::query("INSERT INTO products (id, tenant_id, category_id, name) VALUES ('prd_a', 'ten_a', 'cat_a', 'Un'), ('prd_b', 'ten_b', 'cat_b', 'Yağ'), ('prd_c', 'ten_a', 'cat_a', 'Servis')")
            .execute(&mut *conn).await.unwrap();
        sqlx::query("INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents) VALUES ('bat_a', 'ten_a', 'prd_a', 2.0, 1.5, 300), ('bat_b', 'ten_b', 'prd_b', 5.0, 5.0, 1)")
            .execute(&mut *conn).await.unwrap();

        let products = list_pos_products(&mut conn, "ten_a").await.unwrap();
        assert_eq!(products.len(), 2);
        let flour = products
            .iter()
            .find(|product| product.id == "prd_a")
            .unwrap();
        assert_eq!(flour.stock_quantity, Some(1.5));
        assert!(flour.in_stock);
        let service = products
            .iter()
            .find(|product| product.id == "prd_c")
            .unwrap();
        assert_eq!(service.stock_quantity, None);
        assert!(service.in_stock);

        sqlx::query("UPDATE inventory_batches SET remaining_quantity = 0 WHERE id = 'bat_a' AND tenant_id = 'ten_a'")
            .execute(&mut *conn).await.unwrap();
        let products = list_pos_products(&mut conn, "ten_a").await.unwrap();
        let flour = products
            .iter()
            .find(|product| product.id == "prd_a")
            .unwrap();
        assert_eq!(flour.stock_quantity, Some(0.0));
        assert!(!flour.in_stock);
        assert!(list_pos_products(&mut conn, "").await.is_err());
    }
}
