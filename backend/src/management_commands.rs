use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    pub display_order: i32,
}

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
pub async fn get_management_categories(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<CategoryDto>, String> {
    let role_upper = actor_role.to_uppercase();
    if role_upper != "MANAGER" && role_upper != "OWNER" && role_upper != "MASTER ADMIN" && role_upper != "MASTER" {
        return Err("UNAUTHORIZED: Insufficient permissions to view categories".into());
    }

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, display_order FROM categories ORDER BY display_order ASC")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    
    let mut res = Vec::new();
    for row in rows {
        res.push(CategoryDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            display_order: row.try_get::<i32, _>("display_order").unwrap_or(0),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn create_category(
    actor_role: String,
    name: String,
    display_order: i32,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<CategoryDto, String> {
    if actor_role != "Owner" && actor_role != "OWNER" && actor_role != "Master Admin" && actor_role != "MASTER" {
        return Err("UNAUTHORIZED: Only Owner can create categories".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<CategoryDto, String> = async {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO categories (id, name, display_order) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(&name)
            .bind(display_order)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
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
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<CategoryDto, String> {
    if actor_role != "Owner" && actor_role != "OWNER" && actor_role != "Master Admin" && actor_role != "MASTER" {
        return Err("UNAUTHORIZED: Only Owner can update categories".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<CategoryDto, String> = async {
        sqlx::query("UPDATE categories SET name = ?, display_order = ? WHERE id = ?")
            .bind(&name)
            .bind(display_order)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
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
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    if actor_role != "Owner" && actor_role != "OWNER" && actor_role != "Master Admin" && actor_role != "MASTER" {
        return Err("UNAUTHORIZED: Only Owner can delete categories".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("DELETE FROM products WHERE category_id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
        sqlx::query("DELETE FROM categories WHERE id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
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
pub async fn get_management_products(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<ProductDto>, String> {
    let role_upper = actor_role.to_uppercase();
    if role_upper != "MANAGER" && role_upper != "OWNER" && role_upper != "MASTER ADMIN" && role_upper != "MASTER" {
        return Err("UNAUTHORIZED: Insufficient permissions to view products".into());
    }

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, category_id, name, price_cents, image_url, is_active FROM products")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        res.push(ProductDto {
            id: row.try_get("id").unwrap_or_default(),
            category_id: row.try_get("category_id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            price_cents: row.try_get::<i32, _>("price_cents").unwrap_or(0),
            image_url: row.try_get("image_url").ok(),
            is_active: row.try_get::<bool, _>("is_active").unwrap_or(true),
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
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ProductDto, String> {
    if actor_role.to_uppercase() != "OWNER" {
        return Err("UNAUTHORIZED: Only Owner can create products and set pricing".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO products (id, category_id, name, price_cents, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&category_id)
            .bind(&name)
            .bind(price_cents)
            .bind(&image_url)
            .bind(is_active)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        
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
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ProductDto, String> {
    if actor_role.to_uppercase() != "OWNER" {
        return Err("UNAUTHORIZED: Only Owner can update product details and pricing".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        sqlx::query("UPDATE products SET category_id = ?, name = ?, price_cents = ?, image_url = ?, is_active = ? WHERE id = ?")
            .bind(&category_id)
            .bind(&name)
            .bind(price_cents)
            .bind(&image_url)
            .bind(is_active)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        
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
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let role_upper = actor_role.to_uppercase();
    if role_upper != "MANAGER" && role_upper != "OWNER" && role_upper != "MASTER ADMIN" && role_upper != "MASTER" {
        return Err("UNAUTHORIZED: Insufficient permissions to update product status".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("UPDATE products SET is_active = ? WHERE id = ?")
        .bind(is_active)
        .bind(&id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    Ok(())
}

#[tauri::command]
pub async fn delete_product(
    actor_role: String,
    id: String,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    if actor_role != "Owner" && actor_role != "OWNER" && actor_role != "Master Admin" && actor_role != "MASTER" {
        return Err("UNAUTHORIZED: Only Owner can delete products".into());
    }
    
    let _lock = app_state.audit_mutex.lock().await;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("DELETE FROM products WHERE id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
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

// ─── Staff Management ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StaffMemberDto {
    pub id: String,
    pub name: String,
    pub role: String,
    pub tenant_id: String,
}

#[tauri::command]
pub async fn get_staff(actor_role: String, tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<StaffMemberDto>, String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" && role_up != "MASTER" && role_up != "MANAGER" {
        return Err("UNAUTHORIZED: Only Owner or Manager can manage staff".into());
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, role, tenant_id FROM users WHERE tenant_id = ? ORDER BY name ASC")
        .bind(&tenant_id).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let staff = rows.into_iter().map(|r| StaffMemberDto {
        id: r.try_get("id").unwrap_or_default(),
        name: r.try_get("name").unwrap_or_default(),
        role: r.try_get("role").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
    }).collect();
    Ok(staff)
}

#[tauri::command]
pub async fn create_staff_member(
    actor_role: String, tenant_id: String, name: String,
    role: String, pin: String,
    pool: tauri::State<'_, DbPool>
) -> Result<StaffMemberDto, String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" && role_up != "MASTER" && role_up != "MANAGER" {
        return Err("UNAUTHORIZED: Only Owner or Manager can create staff".into());
    }
    let allowed_roles: Vec<&str> = if role_up == "MASTER" {
        vec!["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN", "MASTER"]
    } else {
        vec!["MANAGER", "CASHIER", "WAITER", "KITCHEN"]
    };
    if !allowed_roles.contains(&role.as_str()) {
        return Err(format!("Invalid role: {}. Allowed: {}", role, allowed_roles.join(", ")));
    }
    // PIN format denetimi: 4 ila 8 haneli sayısal olmalıdır
    if !pin.chars().all(|c| c.is_ascii_digit()) || !(4..=8).contains(&pin.len()) {
        return Err("PIN 4-8 haneli sayısal olmalıdır.".into());
    }
    let hash = crate::auth::hash_credential(&pin).ok();
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users (id, tenant_id, pin, role, name, credential_hash) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id).bind(&tenant_id).bind(&pin).bind(&role).bind(&name).bind(&hash)
        .execute(&mut *conn).await.map_err(|e| e.to_string())?;
    Ok(StaffMemberDto { id, name, role, tenant_id })
}

#[tauri::command]
pub async fn delete_staff_member(actor_role: String, staff_id: String, pool: tauri::State<'_, DbPool>) -> Result<(), String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" && role_up != "MASTER" && role_up != "MANAGER" {
        return Err("UNAUTHORIZED: Only Owner or Manager can delete staff".into());
    }
    // Master admin kullanıcısının silinmesini engelle
    if staff_id == "usr_master" {
        return Err("UNAUTHORIZED: Master Admin hesabı silinemez.".into());
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&staff_id).execute(&mut *conn).await.map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Modifier Management ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_modifier_groups(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" && role_up != "MASTER" {
        return Err("UNAUTHORIZED: Only Owner can manage modifiers".into());
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let groups = sqlx::query("SELECT id, name, is_required, min_selections, max_selections FROM modifier_groups ORDER BY name ASC")
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for g in groups {
        let group_id: String = g.try_get("id").unwrap_or_default();
        let options = sqlx::query("SELECT id, name, price_cents FROM modifier_options WHERE group_id = ?")
            .bind(&group_id).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        let opts: Vec<serde_json::Value> = options.into_iter().map(|o| serde_json::json!({
            "id": o.try_get::<String,_>("id").unwrap_or_default(),
            "name": o.try_get::<String,_>("name").unwrap_or_default(),
            "priceCents": o.try_get::<i64,_>("price_cents").unwrap_or(0),
        })).collect();
        result.push(serde_json::json!({
            "id": group_id,
            "name": g.try_get::<String,_>("name").unwrap_or_default(),
            "isRequired": g.try_get::<bool,_>("is_required").unwrap_or(false),
            "minSelections": g.try_get::<i64,_>("min_selections").unwrap_or(0),
            "maxSelections": g.try_get::<Option<i64>,_>("max_selections").ok().flatten(),
            "options": opts,
        }));
    }
    Ok(result)
}

#[tauri::command]
pub async fn create_modifier_group(
    actor_role: String, name: String, is_required: bool,
    min_selections: i64, max_selections: Option<i64>, tenant_id: String,
    pool: tauri::State<'_, DbPool>
) -> Result<String, String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" { return Err("UNAUTHORIZED: Only Owner can create modifier groups".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO modifier_groups (id, tenant_id, name, is_required, min_selections, max_selections) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id).bind(&tenant_id).bind(&name).bind(is_required).bind(min_selections).bind(max_selections)
        .execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn add_modifier_option(
    actor_role: String, group_id: String, name: String, price_cents: i64,
    pool: tauri::State<'_, DbPool>
) -> Result<String, String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" { return Err("UNAUTHORIZED: Only Owner can add modifier options".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO modifier_options (id, group_id, name, price_cents) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(&group_id).bind(&name).bind(price_cents)
        .execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_modifier_group(actor_role: String, group_id: String, pool: tauri::State<'_, DbPool>) -> Result<(), String> {
    let role_up = actor_role.to_uppercase();
    if role_up != "OWNER" { return Err("UNAUTHORIZED: Only Owner can delete modifier groups".into()); }
    sqlx::query("DELETE FROM modifier_groups WHERE id = ?")
        .bind(&group_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(())
}