//! Urun yonetimi komutlari.
//!
//! Tenant izolasyonu krali: `tenant_id` **her zaman cagirandan** gelir ve her
//! `SELECT`/`UPDATE`/`DELETE` icinde `WHERE` olarak yer alir. Kategori tasima
//! islemi de ayni kiraciyi sinar; aksi halde urun baska isletmenin kategorisine
//! baglanir ve menu orada gorunur.

use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::{audit_actor, ensure_owned, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProductDto {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub price_cents: i32,
    pub image_url: Option<String>,
    pub is_active: bool,
}

#[tauri::command]
pub async fn get_management_products(
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ProductDto>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, category_id, name, price_cents, image_url, is_active FROM products WHERE tenant_id = ? ORDER BY name ASC")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for row in rows {
        res.push(ProductDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            category_id: row.try_get("category_id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            price_cents: row.try_get::<i32, _>("price_cents").map_err(|e| e.to_string())?,
            image_url: row.try_get("image_url").ok(),
            is_active: row.try_get::<bool, _>("is_active").map_err(|e| e.to_string())?,
        });
    }
    Ok(res)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_product(
    actor_role: String,
    category_id: String,
    name: String,
    price_cents: i32,
    image_url: Option<String>,
    is_active: bool,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ProductDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        let id = Uuid::new_v4().to_string();
        // Kategori kimliği başka işletmeye aitse ürün o işletmenin menüsünde
        // görünür. INSERT öncesi sınanır.
        ensure_owned(&mut conn, "categories", &category_id, &tenant_id).await?;
        sqlx::query("INSERT INTO products (id, tenant_id, category_id, name, price_cents, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(&category_id)
            .bind(&name)
            .bind(price_cents)
            .bind(&image_url)
            .bind(is_active)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:product_created", &id,
            serde_json::json!({
                "name": name,
                "categoryId": category_id,
                "priceCents": price_cents,
                "isActive": is_active,
            }),
        ).await?;

        Ok(ProductDto { id, category_id, name, price_cents, image_url, is_active })
    }.await;

    match result {
        Ok(v) => {
            sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(e)
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_product(
    actor_role: String,
    id: String,
    category_id: String,
    name: String,
    price_cents: i32,
    image_url: Option<String>,
    is_active: bool,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ProductDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    ensure_owned(&mut conn, "products", &id, &tenant_id).await?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        // Ürünün taşınacağı kategori de bu işletmenin menüsünde olmalı; aksi
        // halde ürün başka işletmenin kategorisine bağlanır ve menü orada görünür.
        ensure_owned(&mut conn, "categories", &category_id, &tenant_id).await?;
        // Fiyat ve ad değişikliği mali sonuç doğurur; eski değerler "Eski Değer →
        // Yeni Değer" sütununda gösterilmek üzere kayda geçer.
        let previous: Option<(String, i64, bool)> =
            sqlx::query_as("SELECT name, price_cents, is_active FROM products WHERE id = ? AND tenant_id = ?")
                .bind(&id)
                .bind(&tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

        sqlx::query("UPDATE products SET category_id = ?, name = ?, price_cents = ?, image_url = ?, is_active = ? WHERE id = ? AND tenant_id = ?")
            .bind(&category_id)
            .bind(&name)
            .bind(price_cents)
            .bind(&image_url)
            .bind(is_active)
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        let (previous_name, previous_price, previous_active) = previous
            .map(|(n, p, a)| (serde_json::json!(n), p, a))
            .unwrap_or((serde_json::Value::Null, price_cents as i64, is_active));

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:product_updated", &id,
            serde_json::json!({
                "changes": {
                    "name": { "old": previous_name, "new": name },
                    "priceCents": { "old": previous_price, "new": price_cents },
                    "isActive": { "old": previous_active, "new": is_active },
                }
            }),
        ).await?;

        Ok(ProductDto { id, category_id, name, price_cents, image_url, is_active })
    }.await;

    match result {
        Ok(v) => {
            sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn update_product_status(
    actor_role: String,
    id: String,
    is_active: bool,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    ensure_owned(&mut conn, "products", &id, &tenant_id).await?;
    let previous_active: Option<bool> = sqlx::query_scalar("SELECT is_active FROM products WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("UPDATE products SET is_active = ? WHERE id = ? AND tenant_id = ?")
            .bind(is_active)
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:product_status_changed", &id,
            serde_json::json!({
                "changes": { "isActive": { "old": previous_active, "new": is_active } }
            }),
        ).await?;

        Ok(())
    }.await;

    match result {
        Ok(v) => {
            sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn delete_product(
    actor_role: String,
    id: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    ensure_owned(&mut conn, "products", &id, &tenant_id).await?;
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("DELETE FROM products WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:product_deleted", &id,
            serde_json::json!({ "name": previous_name }),
        ).await?;

        Ok(())
    }.await;

    match result {
        Ok(v) => {
            sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(e)
        }
    }
}
