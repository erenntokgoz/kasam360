use crate::db::DbPool;
use crate::rbac::{self, Role};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use sqlx::{Acquire, Row};

use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Denetim defterine tek satır yazar. Yönetim komutları zaten `audit_mutex`
/// tutuyordu ama hiçbiri kayıt yazmıyordu; menü, ürün, personel ve modifier
/// değişiklikleri defter dışında kalıyordu.
async fn record_audit(
    conn: &mut sqlx::SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    category: &'static str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    Ok(())
}

/// Çağıran oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır; yönetim
/// ekranları oturum kullanıcısını `actor_id`/`actor_role` ile geçer.
fn audit_actor(actor_id: Option<String>, actor_role: &str) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.to_string(),
    )
}

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
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

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
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<CategoryDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
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
            crate::services::audit_service::category::MENU,
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
    let tenant_id: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<CategoryDto, String> = async {
        let previous: Option<(String, i32)> =
            sqlx::query_as("SELECT name, display_order FROM categories WHERE id = ?")
                .bind(&id).fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;

        sqlx::query("UPDATE categories SET name = ?, display_order = ? WHERE id = ?")
            .bind(&name)
            .bind(display_order)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
            crate::services::audit_service::category::MENU,
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
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        let removed_products = sqlx::query("DELETE FROM products WHERE category_id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            
        sqlx::query("DELETE FROM categories WHERE id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        // Kategori silinince altındaki ürünler de silinir; kaç ürünün etkilendiği
        // defterde görünmelidir, aksi halde menü kaydı izlenemez.
        record_audit(
            &mut conn, &lock, &resolved_tenant, &actor_id, &actor_role,
            crate::services::audit_service::category::MENU,
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

#[tauri::command]
pub async fn get_management_products(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<ProductDto>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

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
    actor_id: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<ProductDto, String> {
    if actor_role.to_uppercase() != "OWNER" {
        return Err("UNAUTHORIZED: Only Owner can create products and set pricing".into());
    }
    
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        let id = Uuid::new_v4().to_string();
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
            crate::services::audit_service::category::MENU,
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
    if actor_role.to_uppercase() != "OWNER" {
        return Err("UNAUTHORIZED: Only Owner can update product details and pricing".into());
    }
    
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<ProductDto, String> = async {
        // Fiyat ve ad değişikliği mali sonuç doğurur; eski değerler "Eski Değer →
        // Yeni Değer" sütununda gösterilmek üzere kayda geçer.
        let previous: Option<(String, i64, bool)> =
            sqlx::query_as("SELECT name, price_cents, is_active FROM products WHERE id = ?")
                .bind(&id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

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

        let (previous_name, previous_price, previous_active) = previous
            .map(|(n, p, a)| (serde_json::json!(n), p, a))
            .unwrap_or((serde_json::Value::Null, price_cents as i64, is_active));

        record_audit(
            &mut conn, &lock, &resolved_tenant, &actor_id, &actor_role,
            crate::services::audit_service::category::MENU,
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
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    let previous_active: Option<bool> = sqlx::query_scalar("SELECT is_active FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("UPDATE products SET is_active = ? WHERE id = ?")
            .bind(is_active)
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &resolved_tenant, &actor_id, &actor_role,
            crate::services::audit_service::category::MENU,
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
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM products WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();
    
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("DELETE FROM products WHERE id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        record_audit(
            &mut conn, &lock, &resolved_tenant, &actor_id, &actor_role,
            crate::services::audit_service::category::MENU,
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
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Pasife alınmış personel listelenmez: kayıt silinmez ama işletme panosunda
    // görünmez. Yeniden canlandırma bu fazın kapsamı dışında.
    let rows = sqlx::query("SELECT id, name, role, tenant_id FROM users WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC")
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
    role: String, pin: String, actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<StaffMemberDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    // SPEC: MASTER personel yönetimine sahip değildir; bu yüzden platform rolleri
    // (MASTER dahil) bu komuttan atanamaz. Rolü atanacak kişi de tenant'ın
    // operasyonel rollerinden biri olmak zorundadır.
    let allowed_roles: Vec<&str> = vec!["MANAGER", "CASHIER", "WAITER", "KITCHEN"];
    if !allowed_roles.contains(&role.as_str()) {
        return Err(format!("Invalid role: {}. Allowed: {}", role, allowed_roles.join(", ")));
    }
    // PIN düz metin saklanmaz; hash_pin format denetimini de yapar.
    let hash = crate::user_credentials::hash_pin(&pin)?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Ön kontrol ve yazma aynı transaction içindedir: PIN benzersizliği veritabanı
    // indeksine değil uygulama katmanına yaslanıyor (hash'ler karşılaştırılamaz).
    crate::user_credentials::ensure_pin_available(&mut tx, &tenant_id, &pin, None).await?;

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES (?, ?, ?, ?, ?, 1)")
        .bind(&id).bind(&tenant_id).bind(&role).bind(&name).bind(&hash)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    // Yarış denetimi: ön kontrol ile yazma arasına başka bir istek girmiş olabilir.
    // Çakışma varsa transaction geri alınır, kayıt oluşmaz.
    crate::user_credentials::ensure_pin_unique_after_write(&mut tx, &tenant_id, &pin, &id).await?;

    // Rol ataması yetki matrisini değiştirdiği için kayıt "Personel" kategorisine
    // yazılır; defterde PIN'in kendisi ya da hash'i bulunmaz.
    record_audit(
        &mut tx, &lock, &tenant_id, &actor_id, &actor_role,
        crate::services::audit_service::category::PERSONEL,
        "staff:created", &id,
        serde_json::json!({ "name": name, "assignedRole": role }),
    ).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(StaffMemberDto { id, name, role, tenant_id })
}

#[tauri::command]
pub async fn delete_staff_member(
    actor_role: String, staff_id: String, actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    // Master admin kullanıcısının pasife alınmasını engelle
    if staff_id == "usr_master" {
        return Err("UNAUTHORIZED: Master Admin hesabı silinemez.".into());
    }
    // Personel silinmez, pasife alınır (AGENTS.md §6). Kayıt, geçmiş sipariş ve
    // vardiya satırlarının referansı olduğu için fiziksel olarak korunur.
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let tenant_id: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM users WHERE id = ?")
        .bind(&staff_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let previous: Option<(String, String)> = sqlx::query_as("SELECT name, role FROM users WHERE id = ?")
        .bind(&staff_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();

    let result = sqlx::query("UPDATE users SET is_active = 0 WHERE id = ?")
        .bind(&staff_id).execute(&mut *conn).await.map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Kullanıcı bulunamadı.".into());
    }

    let (staff_name, staff_role) = previous
        .map(|(n, r)| (n, r))
        .unwrap_or_else(|| (String::new(), String::new()));
    record_audit(
        &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
        crate::services::audit_service::category::PERSONEL,
        "staff:deactivated", &staff_id,
        serde_json::json!({
            "name": staff_name,
            "role": staff_role,
            "changes": { "isActive": { "old": true, "new": false } },
        }),
    ).await?;

    Ok(())
}

// ─── Modifier Management ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_modifier_groups(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
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
    actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO modifier_groups (id, tenant_id, name, is_required, min_selections, max_selections) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id).bind(&tenant_id).bind(&name).bind(is_required).bind(min_selections).bind(max_selections)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    record_audit(
        &mut tx, &lock, &tenant_id, &actor_id, &actor_role,
        crate::services::audit_service::category::MENU,
        "menu:modifier_group_created", &id,
        serde_json::json!({ "name": name, "isRequired": is_required }),
    ).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn add_modifier_option(
    actor_role: String, group_id: String, name: String, price_cents: i64,
    actor_id: Option<String>, tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM modifier_groups WHERE id = ?")
        .bind(&group_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO modifier_options (id, group_id, name, price_cents) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(&group_id).bind(&name).bind(price_cents)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    record_audit(
        &mut tx, &lock, &resolved_tenant, &actor_id, &actor_role,
        crate::services::audit_service::category::MENU,
        "menu:modifier_option_added", &id,
        serde_json::json!({ "groupId": group_id, "name": name, "priceCents": price_cents }),
    ).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn delete_modifier_group(
    actor_role: String, group_id: String, actor_id: Option<String>, tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let resolved_tenant: String = sqlx::query_scalar("SELECT COALESCE(tenant_id, 'DEFAULT_TENANT') FROM modifier_groups WHERE id = ?")
        .bind(&group_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string()));
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM modifier_groups WHERE id = ?")
        .bind(&group_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    let removed = sqlx::query("DELETE FROM modifier_groups WHERE id = ?")
        .bind(&group_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;

    record_audit(
        &mut tx, &lock, &resolved_tenant, &actor_id, &actor_role,
        crate::services::audit_service::category::MENU,
        "menu:modifier_group_deleted", &group_id,
        serde_json::json!({ "name": previous_name }),
    ).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    let _ = removed;
    Ok(())
}
