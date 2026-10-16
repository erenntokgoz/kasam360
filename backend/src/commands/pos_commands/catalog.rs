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
    pub description: Option<String>,
    #[serde(rename = "inStock", alias = "in_stock")]
    pub in_stock: bool,
    #[serde(rename = "stockQuantity", alias = "stock_quantity")]
    pub stock_quantity: Option<i64>,
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
    let rows = sqlx::query(
        "SELECT p.id, p.sku, p.barcode, p.name, p.price_cents, p.tax_rate_bp, \
                c.name as category_name, p.description, p.track_stock, p.stock_quantity, \
                p.color, p.image_url, p.is_active, p.is_86, p.stockout_reason, \
                COALESCE(SUM(oi.quantity), 0) AS sold_quantity \
         FROM products p \
         JOIN categories c ON p.category_id = c.id \
         LEFT JOIN order_items oi ON oi.product_id = p.id AND oi.tenant_id = p.tenant_id \
         WHERE p.tenant_id = ? \
         GROUP BY p.id \
         ORDER BY p.name ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for row in rows {
        let is_active: bool = row.try_get("is_active").unwrap_or(true);
        let is_86: bool = row.try_get("is_86").unwrap_or(false);
        let stockout_reason: Option<String> = row.try_get("stockout_reason").ok();
        let track_stock: bool = row.try_get("track_stock").unwrap_or(false);
        let stock_quantity: i64 = row.try_get("stock_quantity").unwrap_or(0);
        let sold: i64 = row.try_get("sold_quantity").unwrap_or(0);
        let current_stock = stock_quantity - sold;

        res.push(PosProductDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            sku: row.try_get("sku").unwrap_or_default(),
            barcode: row.try_get("barcode").ok(),
            name: row.try_get("name").map_err(|e| e.to_string())?,
            price_cents: row.try_get("price_cents").map_err(|e| e.to_string())?,
            tax_rate_bp: row.try_get("tax_rate_bp").unwrap_or(1000),
            category: row.try_get("category_name").map_err(|e| e.to_string())?,
            description: row.try_get("description").ok(),
            in_stock: is_active && !is_86 && (!track_stock || current_stock > 0),
            stock_quantity: if track_stock {
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
