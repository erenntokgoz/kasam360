//! Kategori yönetimi komutları.
//!
//! Tenant izolasyonu kralı: `tenant_id` **her zaman çağırandan** gelir ve her
//! `SELECT`/`UPDATE`/`DELETE` icinde `WHERE` olarak yer alir. Kimlik tek basina
//! filtre degildir; kimlikler global benzersiz olsa bile baska isletmenin
//! kaydina isaret edebilir.

use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::{audit_actor, ensure_owned, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    pub display_order: i32,
}

#[tauri::command]
pub async fn get_management_categories(
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CategoryDto>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, display_order FROM categories WHERE tenant_id = ? ORDER BY display_order ASC")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for row in rows {
        res.push(CategoryDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            display_order: row.try_get::<i32, _>("display_order").map_err(|e| e.to_string())?,
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn create_category(
    actor_role: String,
    name: String,
    display_order: i32,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<CategoryDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<CategoryDto, String> = async {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO categories (id, tenant_id, name, display_order) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(&name)
            .bind(display_order)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:category_created", &id,
            serde_json::json!({ "name": name, "displayOrder": display_order }),
        ).await?;

        Ok(CategoryDto { id, name, display_order })
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
pub async fn update_category(
    actor_role: String,
    id: String,
    name: String,
    display_order: i32,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<CategoryDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    ensure_owned(&mut conn, "categories", &id, &tenant_id).await?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<CategoryDto, String> = async {
        let previous: Option<(String, i32)> =
            sqlx::query_as("SELECT name, display_order FROM categories WHERE id = ? AND tenant_id = ?")
                .bind(&id).bind(&tenant_id)
                .fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;

        sqlx::query("UPDATE categories SET name = ?, display_order = ? WHERE id = ? AND tenant_id = ?")
            .bind(&name)
            .bind(display_order)
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:category_updated", &id,
            serde_json::json!({
                "changes": {
                    "name": {
                        "old": previous.as_ref().map(|p| p.0.clone()),
                        "new": name,
                    },
                    "displayOrder": {
                        "old": previous.as_ref().map(|p| p.1),
                        "new": display_order,
                    },
                }
            }),
        ).await?;

        Ok(CategoryDto { id, name, display_order })
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
pub async fn delete_category(
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
    ensure_owned(&mut conn, "categories", &id, &tenant_id).await?;
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM categories WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        // `category_id` tek başına filtre değildir: kategoriler kimlik global
        // benzersiz olsa bile tenant'sız DELETE başka işletmenin ürünlerini
        // silerdi. İki filtre birlikte zorunlu.
        let removed_products = sqlx::query("DELETE FROM products WHERE category_id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        sqlx::query("DELETE FROM categories WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        // Kategori silinince altındaki ürünler de silinir; kaç ürünün etkilendiği
        // defterde görünmelidir, aksi halde menü kaydı izlenemez.
        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            category::MENU,
            "menu:category_deleted", &id,
            serde_json::json!({
                "name": previous_name,
                "removedProductCount": removed_products.rows_affected(),
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
