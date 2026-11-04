//! Ürünün menü ayrıntıları: istasyon, web menüsü, görsel ve dizilim sırası.
//!
//! Neden ayrı komut: ürün kaydı fiyat ve stok birimiyle denetime girer. Bu alanlar
//! satış tutarını değiştirmez; ayrı tutulunca ürün kaydının sözleşmesi bozulmaz.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::{ensure_owned, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::lan_sync::WritePool;

/// Veritabanına gömülen görsel satırı şişirmesin: küçük bir menü fotoğrafı yeter.
const MAX_IMAGE_BYTES: usize = 400_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductExtras {
    id: String,
    station: Option<String>,
    on_web: bool,
    display_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductExtrasInput {
    id: String,
    station: Option<String>,
    on_web: bool,
    image_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryParent {
    id: String,
    parent_id: Option<String>,
}

#[tauri::command]
pub async fn get_menu_extras(
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(Vec<ProductExtras>, Vec<CategoryParent>), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let products =
        sqlx::query("SELECT id, station, on_web, display_order FROM products WHERE tenant_id = ?")
            .bind(&tenant_id)
            .fetch_all(&*pool)
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .map(|row| {
                Ok(ProductExtras {
                    id: row.try_get("id").map_err(|e| e.to_string())?,
                    station: row.try_get("station").map_err(|e| e.to_string())?,
                    on_web: row.try_get("on_web").map_err(|e| e.to_string())?,
                    display_order: row.try_get("display_order").map_err(|e| e.to_string())?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
    let categories = sqlx::query("SELECT id, parent_id FROM categories WHERE tenant_id = ?")
        .bind(&tenant_id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|row| {
            Ok(CategoryParent {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                parent_id: row.try_get("parent_id").map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((products, categories))
}

#[tauri::command]
pub async fn set_product_extras(
    actor_role: String,
    tenant_id: Option<String>,
    input: ProductExtrasInput,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    if input
        .image_url
        .as_ref()
        .is_some_and(|image| image.len() > MAX_IMAGE_BYTES)
    {
        return Err("VALIDATION: görsel çok büyük, daha küçük bir fotoğraf seçin".into());
    }
    let station = input
        .station
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let mut conn = pool.begin_write().await?;
    ensure_owned(&mut conn, "products", &input.id, &tenant_id).await?;
    sqlx::query(
        "UPDATE products SET station = ?, on_web = ?, image_url = COALESCE(?, image_url)
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(&station)
    .bind(input.on_web)
    .bind(&input.image_url)
    .bind(&input.id)
    .bind(&tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    conn.commit().await?;
    Ok(())
}

/// Sipariş ekranı ürünleri bu sırayla dizer; liste baştan yazılır.
#[tauri::command]
pub async fn set_product_order(
    actor_role: String,
    tenant_id: Option<String>,
    ids: Vec<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.begin_write().await?;
    for (index, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE products SET display_order = ? WHERE id = ? AND tenant_id = ?")
            .bind(i64::try_from(index).map_err(|e| e.to_string())?)
            .bind(id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    conn.commit().await?;
    Ok(())
}

/// Alt kategori tek seviyedir: üst kategorinin kendisi alt kategori olamaz.
#[tauri::command]
pub async fn set_category_parent(
    actor_role: String,
    tenant_id: Option<String>,
    id: String,
    parent_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.begin_write().await?;
    ensure_owned(&mut conn, "categories", &id, &tenant_id).await?;
    if let Some(parent) = parent_id.as_deref() {
        ensure_owned(&mut conn, "categories", parent, &tenant_id).await?;
        let nested: Option<Option<String>> =
            sqlx::query_scalar("SELECT parent_id FROM categories WHERE id = ? AND tenant_id = ?")
                .bind(parent)
                .bind(&tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        let has_children: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM categories WHERE parent_id = ? AND tenant_id = ?",
        )
        .bind(&id)
        .bind(&tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if parent == id || nested.flatten().is_some() || has_children > 0 {
            return Err("VALIDATION: alt kategori tek seviyedir".into());
        }
    }
    sqlx::query("UPDATE categories SET parent_id = ? WHERE id = ? AND tenant_id = ?")
        .bind(&parent_id)
        .bind(&id)
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    conn.commit().await?;
    Ok(())
}
