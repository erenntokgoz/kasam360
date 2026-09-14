use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct TenantDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub plan_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlanDto {
    pub id: String,
    pub name: String,
    pub monthly_price_cents: i64,
    pub max_devices: i64,
    pub max_users: i64,
    pub max_branches: Option<i64>,
    pub features: Option<Vec<String>>,
    pub badge: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionDto {
    pub id: String,
    pub tenant_id: String,
    pub plan_id: String,
    pub status: String,
    pub renews_at: Option<String>,
}

#[tauri::command]
pub async fn get_tenants(caller_role: String, caller_tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<TenantDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    // Multi-tenant isolation: MASTER sees all, others see only their own
    let query = if caller_role == "MASTER" {
        "SELECT id, name, status, plan_id, created_at FROM tenants"
    } else {
        "SELECT id, name, status, plan_id, created_at FROM tenants WHERE id = ?"
    };
    
    let mut q = sqlx::query(query);
    if caller_role != "MASTER" {
        q = q.bind(caller_tenant_id);
    }
    
    let rows = q.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    
    let tenants = rows.into_iter().map(|row| TenantDto {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        plan_id: row.try_get("plan_id").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }).collect();
    
    Ok(tenants)
}

#[tauri::command]
pub async fn get_plans(pool: tauri::State<'_, DbPool>) -> Result<Vec<PlanDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, monthly_price_cents, max_devices, max_users, max_branches, features, badge FROM plans")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let plans = rows.into_iter().map(|row| {
        let features_raw: Option<String> = row.try_get("features").ok();
        let features: Option<Vec<String>> = features_raw.and_then(|f| serde_json::from_str(&f).ok());
        PlanDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            monthly_price_cents: row.try_get("monthly_price_cents").unwrap_or_default(),
            max_devices: row.try_get("max_devices").unwrap_or_default(),
            max_users: row.try_get("max_users").unwrap_or_default(),
            max_branches: row.try_get("max_branches").ok(),
            features,
            badge: row.try_get("badge").ok(),
        }
    }).collect();
    Ok(plans)
}

#[tauri::command]
pub async fn create_plan(
    caller_role: Option<String>,
    id: Option<String>,
    name: String,
    monthly_price_cents: i64,
    max_devices: i64,
    max_users: i64,
    max_branches: Option<i64>,
    features: Option<Vec<String>>,
    badge: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<PlanDto, String> {
    if let Some(ref role) = caller_role {
        if role != "MASTER" && role != "SuperAdmin" {
            return Err("UNAUTHORIZED: Sadece MASTER/Platform yöneticisi paket oluşturabilir.".into());
        }
    }
    let plan_id = id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| format!("plan_{}", Uuid::new_v4().to_string()[..8].to_string()));
    let branches = max_branches.unwrap_or(1);
    let features_json = features.as_ref().map(|f| serde_json::to_string(f).unwrap_or_default());

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO plans (id, name, monthly_price_cents, max_devices, max_users, max_branches, features, badge)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&plan_id)
    .bind(&name)
    .bind(monthly_price_cents)
    .bind(max_devices)
    .bind(max_users)
    .bind(branches)
    .bind(&features_json)
    .bind(&badge)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Paket oluşturulamadı: {}", e))?;

    Ok(PlanDto {
        id: plan_id,
        name,
        monthly_price_cents,
        max_devices,
        max_users,
        max_branches: Some(branches),
        features,
        badge,
    })
}

#[tauri::command]
pub async fn update_plan(
    caller_role: Option<String>,
    id: String,
    name: String,
    monthly_price_cents: i64,
    max_devices: i64,
    max_users: i64,
    max_branches: Option<i64>,
    features: Option<Vec<String>>,
    badge: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<PlanDto, String> {
    if let Some(ref role) = caller_role {
        if role != "MASTER" && role != "SuperAdmin" {
            return Err("UNAUTHORIZED: Sadece MASTER/Platform yöneticisi paket güncelleyebilir.".into());
        }
    }
    let branches = max_branches.unwrap_or(1);
    let features_json = features.as_ref().map(|f| serde_json::to_string(f).unwrap_or_default());

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE plans 
         SET name = ?, monthly_price_cents = ?, max_devices = ?, max_users = ?, max_branches = ?, features = ?, badge = ?
         WHERE id = ?"
    )
    .bind(&name)
    .bind(monthly_price_cents)
    .bind(max_devices)
    .bind(max_users)
    .bind(branches)
    .bind(&features_json)
    .bind(&badge)
    .bind(&id)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Paket güncellenemedi: {}", e))?;

    Ok(PlanDto {
        id,
        name,
        monthly_price_cents,
        max_devices,
        max_users,
        max_branches: Some(branches),
        features,
        badge,
    })
}

#[tauri::command]
pub async fn delete_plan(
    caller_role: Option<String>,
    id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    if let Some(ref role) = caller_role {
        if role != "MASTER" && role != "SuperAdmin" {
            return Err("UNAUTHORIZED: Sadece MASTER/Platform yöneticisi paket silebilir.".into());
        }
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Silme koruması: pakete bağlı aktif abonelik veya kiracı var mı?
    let active_subs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM subscriptions WHERE plan_id = ? AND status = 'ACTIVE'"
    )
    .bind(&id)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);

    let attached_tenants: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tenants WHERE plan_id = ?"
    )
    .bind(&id)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);

    if active_subs > 0 || attached_tenants > 0 {
        return Err(format!(
            "Bu pakete tanımlı {} adet aktif işletme/abone bulunmaktadır! Paketi silmeden önce aboneleri başka bir pakete aktarınız.",
            active_subs.max(attached_tenants)
        ));
    }

    sqlx::query("DELETE FROM plans WHERE id = ?")
        .bind(&id)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("Paket silinemedi: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_subscriptions(caller_role: String, caller_tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<SubscriptionDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    let query = if caller_role == "MASTER" {
        "SELECT id, tenant_id, plan_id, status, renews_at FROM subscriptions"
    } else {
        "SELECT id, tenant_id, plan_id, status, renews_at FROM subscriptions WHERE tenant_id = ?"
    };
    
    let mut q = sqlx::query(query);
    if caller_role != "MASTER" {
        q = q.bind(caller_tenant_id);
    }
    
    let rows = q.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    
    let subs = rows.into_iter().map(|row| SubscriptionDto {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        plan_id: row.try_get("plan_id").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        renews_at: row.try_get("renews_at").ok(),
    }).collect();
    
    Ok(subs)
}

#[tauri::command]
pub async fn create_tenant(name: String, plan_id: Option<String>, pool: tauri::State<'_, DbPool>) -> Result<String, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tenants (id, name, status, plan_id) VALUES (?, ?, 'ACTIVE', ?)")
        .bind(&id)
        .bind(&name)
        .bind(&plan_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(ref pid) = plan_id {
        if !pid.trim().is_empty() {
            let sub_id = Uuid::new_v4().to_string();
            let _ = sqlx::query("INSERT INTO subscriptions (id, tenant_id, plan_id, status, renews_at) VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+30 days'))")
                .bind(&sub_id)
                .bind(&id)
                .bind(pid)
                .execute(&mut *conn)
                .await;
        }
    }

    Ok(id)
}

#[tauri::command]
pub async fn suspend_tenant(caller_role: String, tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<(), String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    sqlx::query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = ?")
        .bind(&tenant_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'SUSPENDED' WHERE tenant_id = ?")
        .bind(&tenant_id).execute(&*pool).await;
    Ok(())
}

#[tauri::command]
pub async fn activate_tenant(caller_role: String, tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<(), String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    sqlx::query("UPDATE tenants SET status = 'ACTIVE' WHERE id = ?")
        .bind(&tenant_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'ACTIVE' WHERE tenant_id = ?")
        .bind(&tenant_id).execute(&*pool).await;
    Ok(())
}

#[tauri::command]
pub async fn update_tenant_subscription(
    caller_role: String,
    tenant_id: String,
    plan_id: String,
    add_days: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // 1. Tenants tablosunu güncelle
    sqlx::query("UPDATE tenants SET plan_id = ? WHERE id = ?")
        .bind(&plan_id)
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Subscriptions tablosunu güncelle veya ekle
    let days_to_add = add_days.unwrap_or(30);
    let days_str = format!("+{} days", days_to_add);

    let rows_affected = sqlx::query(
        "UPDATE subscriptions 
         SET plan_id = ?, 
             status = 'ACTIVE', 
             renews_at = datetime(CASE WHEN renews_at IS NULL OR renews_at < datetime('now') THEN datetime('now') ELSE renews_at END, ?)
         WHERE tenant_id = ?"
    )
    .bind(&plan_id)
    .bind(&days_str)
    .bind(&tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();

    if rows_affected == 0 {
        let sub_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO subscriptions (id, tenant_id, plan_id, status, renews_at) 
             VALUES (?, ?, ?, 'ACTIVE', datetime('now', ?))"
        )
        .bind(&sub_id)
        .bind(&tenant_id)
        .bind(&plan_id)
        .bind(&days_str)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceDto {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub device_type: String,
    pub status: String,
    pub last_heartbeat: Option<String>,
}

#[tauri::command]
pub async fn get_devices(caller_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<DeviceDto>, String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, tenant_id, name, device_type, status, last_heartbeat FROM devices")
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let devices = rows.into_iter().map(|r| DeviceDto {
        id: r.try_get("id").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
        name: r.try_get("name").unwrap_or_default(),
        device_type: r.try_get("device_type").unwrap_or_default(),
        status: r.try_get("status").unwrap_or_default(),
        last_heartbeat: r.try_get("last_heartbeat").ok(),
    }).collect();
    Ok(devices)
}

#[tauri::command]
pub async fn record_device_heartbeat(device_id: String, pool: tauri::State<'_, DbPool>) -> Result<(), String> {
    sqlx::query("UPDATE devices SET last_heartbeat = datetime('now') WHERE id = ?")
        .bind(&device_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn register_device(caller_role: String, tenant_id: String, name: String, device_type: String, pool: tauri::State<'_, DbPool>) -> Result<DeviceDto, String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO devices (id, tenant_id, name, device_type, status) VALUES (?, ?, ?, ?, 'ACTIVE')")
        .bind(&id).bind(&tenant_id).bind(&name).bind(&device_type)
        .execute(&*pool).await.map_err(|e| e.to_string())?;
    Ok(DeviceDto { id, tenant_id, name, device_type, status: "ACTIVE".to_string(), last_heartbeat: None })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlobalUserDto {
    pub id: String,
    pub name: String,
    pub role: String,
    pub tenant_id: String,
}

#[tauri::command]
pub async fn get_global_users(caller_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<GlobalUserDto>, String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, role, tenant_id FROM users")
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let users = rows.into_iter().map(|r| GlobalUserDto {
        id: r.try_get("id").unwrap_or_default(),
        name: r.try_get("name").unwrap_or_default(),
        role: r.try_get("role").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
    }).collect();
    Ok(users)
}

#[tauri::command]
pub async fn get_platform_audit_logs(caller_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    if caller_role != "MASTER" { return Err("UNAUTHORIZED: MASTER only".into()); }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, sequence, timestamp, actor_id, actor_role, action, resource_id, current_hash FROM audit_ledger ORDER BY sequence DESC LIMIT 200")
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let logs: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
        "id": r.try_get::<String,_>("id").unwrap_or_default(),
        "sequence": r.try_get::<i64,_>("sequence").unwrap_or(0),
        "timestamp": r.try_get::<String,_>("timestamp").unwrap_or_default(),
        "actorId": r.try_get::<String,_>("actor_id").unwrap_or_default(),
        "actorRole": r.try_get::<String,_>("actor_role").unwrap_or_default(),
        "action": r.try_get::<String,_>("action").unwrap_or_default(),
        "resourceId": r.try_get::<String,_>("resource_id").unwrap_or_default(),
        "hash": r.try_get::<String,_>("current_hash").unwrap_or_default(),
    })).collect();
    Ok(logs)
}

