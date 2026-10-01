use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InventoryItemDto {
    pub id: String,
    pub name: String,
    pub sku: Option<String>,
    pub current_stock: f64,
    pub unit: String,
    pub min_stock_alert: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StockMovementDto {
    pub id: String,
    pub inventory_item_id: String,
    pub movement_type: String,
    pub quantity: f64,
    pub actor_id: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_inventory(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<InventoryItemDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT id, name, sku, current_stock, unit, min_stock_alert 
         FROM inventory_items 
         WHERE tenant_id = ?"
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(InventoryItemDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            sku: row.try_get("sku").ok(),
            current_stock: row.try_get("current_stock").unwrap_or(0.0),
            unit: row.try_get("unit").unwrap_or_default(),
            min_stock_alert: row.try_get("min_stock_alert").ok(),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn adjust_stock(
    caller_role: Option<String>,
    tenant_id: String, 
    item_id: String, 
    quantity_change: f64, 
    movement_type: String,
    actor_id: String,
    reason: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    // Stok giriş/çıkış parasal değer taşır ve fire kayıtları denetim defterinde
    // tutulur. Önceden hiç rol kapısı yoktu: kasiyer de fire silebiliyordu.
    crate::rbac::require_any_present(caller_role.as_deref(), &[
        crate::rbac::Role::Owner,
        crate::rbac::Role::Manager,
    ])?;

    let audit_lock =
        crate::services::audit_service::AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let previous_stock: f64 = sqlx::query_scalar(
        "SELECT current_stock FROM inventory_items WHERE id = ? AND tenant_id = ?",
    )
    .bind(&item_id)
    .bind(&tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .unwrap_or(0.0);

    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    let movement_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO stock_movements (id, tenant_id, inventory_item_id, movement_type, quantity, actor_id, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&movement_id)
    .bind(&tenant_id)
    .bind(&item_id)
    .bind(&movement_type)
    .bind(quantity_change)
    .bind(&actor_id)
    .bind(&reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE inventory_items SET current_stock = current_stock + ? WHERE id = ? AND tenant_id = ?"
    )
    .bind(quantity_change)
    .bind(&item_id)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Stok hareketi menü/stok tarafındaki kayıttır: kategori listesinde ayrı bir
    // "STOK" kategorisi yoktur, "Menü & Stok" kullanılır.
    let action = if quantity_change < 0.0 {
        "stock:movement_out"
    } else {
        "stock:movement_in"
    };
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        actor_id.clone(),
        caller_role.clone().unwrap_or_default(),
        crate::services::audit_service::category::MENU,
        action,
        item_id.clone(),
        serde_json::json!({
            "movementId": movement_id,
            "movementType": movement_type,
            "quantity": quantity_change,
            "previousStock": previous_stock,
            "newStock": previous_stock + quantity_change,
            "reason": reason,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn create_inventory_item(
    caller_role: Option<String>,
    tenant_id: String, 
    name: String, 
    sku: Option<String>, 
    initial_stock: f64, 
    unit: String, 
    min_stock_alert: Option<f64>, 
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<InventoryItemDto, String> {
    crate::rbac::require_any_present(caller_role.as_deref(), &[
        crate::rbac::Role::Owner,
        crate::rbac::Role::Manager,
    ])?;

    let audit_lock =
        crate::services::audit_service::AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let item_id = Uuid::new_v4().to_string();
    let actor_id = caller_role.clone().unwrap_or_default();

    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO inventory_items (id, tenant_id, name, sku, current_stock, unit, min_stock_alert)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&item_id)
    .bind(&tenant_id)
    .bind(&name)
    .bind(&sku)
    .bind(initial_stock)
    .bind(&unit)
    .bind(&min_stock_alert)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        actor_id,
        caller_role.clone().unwrap_or_default(),
        crate::services::audit_service::category::MENU,
        "stock:created",
        item_id.clone(),
        serde_json::json!({
            "name": name,
            "sku": sku,
            "initialStock": initial_stock,
            "unit": unit,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(InventoryItemDto {
        id: item_id,
        name,
        sku,
        current_stock: initial_stock,
        unit,
        min_stock_alert,
    })
}

#[tauri::command]
pub async fn get_low_stock_alerts(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<InventoryItemDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT id, name, sku, current_stock, unit, min_stock_alert 
         FROM inventory_items 
         WHERE tenant_id = ? AND min_stock_alert IS NOT NULL AND current_stock <= min_stock_alert"
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(InventoryItemDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            sku: row.try_get("sku").ok(),
            current_stock: row.try_get("current_stock").unwrap_or(0.0),
            unit: row.try_get("unit").unwrap_or_default(),
            min_stock_alert: row.try_get("min_stock_alert").ok(),
        });
    }

    Ok(items)
}

