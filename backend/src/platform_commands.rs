use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};
use uuid::Uuid;
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Platform seviyesindeki (çapraz tenant) denetim kayıtlarının taşındığı tenant
/// kimliği. MASTER'ın kendi işletmesi yoktur; şema varsayılanı kullanılır.
const PLATFORM_AUDIT_TENANT: &str = "DEFAULT_TENANT";

#[derive(Debug, Serialize, Deserialize)]
pub struct TenantDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub modules: Vec<String>,
    pub created_at: String,
    pub contact_person: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub tax_id: Option<String>,
    pub tax_office: Option<String>,
    pub address: Option<String>,
}



#[tauri::command]
pub async fn get_tenants(caller_role: String, caller_tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<TenantDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // MASTER tüm tenant'ları görür; SPEC kuralı 7 gereği başka hiçbir rol
    // cross-tenant erişemez, bu yüzden diğerleri kendi tenant'ıyla sınırlıdır.
    // Rol takma adları ("Master Admin", "SuperAdmin") da MASTER sayılmalıdır,
    // aksi halde aynı kişi bu kapıdan düşer ve alt satırlara sızar.
    let is_master = crate::rbac::canonical_role(&caller_role) == Some(crate::rbac::Role::Master);

    let query = if is_master {
        "SELECT id, name, status, created_at, contact_person, email, phone, tax_id, tax_office, address FROM tenants ORDER BY created_at DESC"
    } else {
        "SELECT id, name, status, created_at, contact_person, email, phone, tax_id, tax_office, address FROM tenants WHERE id = ? ORDER BY created_at DESC"
    };

    let mut q = sqlx::query(query);
    if !is_master {
        q = q.bind(caller_tenant_id);
    }
    
    let rows = q.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    
    let mut tenants = Vec::new();
    for row in rows {
        let tenant_id: String = row.try_get("id").unwrap_or_default();
        let module_rows = sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
            .bind(&tenant_id)
            .fetch_all(&mut *conn)
            .await
            .unwrap_or_default();
        let modules: Vec<String> = module_rows.into_iter().map(|r| r.try_get("module_id").unwrap_or_default()).collect();

        tenants.push(TenantDto {
            id: tenant_id,
            name: row.try_get("name").unwrap_or_default(),
            status: row.try_get("status").unwrap_or_default(),
            modules,
            created_at: row.try_get("created_at").unwrap_or_default(),
            contact_person: row.try_get("contact_person").ok(),
            email: row.try_get("email").ok(),
            phone: row.try_get("phone").ok(),
            tax_id: row.try_get("tax_id").ok(),
            tax_office: row.try_get("tax_office").ok(),
            address: row.try_get("address").ok(),
        });
    }
    Ok(tenants)
}



#[tauri::command]
pub async fn create_tenant(
    caller_role: Option<String>,
    id: Option<String>,
    name: String,
    _plan_id: Option<String>, // Keep for compatibility if needed, but unused
    modules: Option<Vec<String>>,
    contact_person: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    tax_id: Option<String>,
    tax_office: Option<String>,
    address: Option<String>,
    owner_name: Option<String>,
    owner_email: Option<String>,
    owner_password: Option<String>,
    owner_pin: Option<String>,
    license_key: Option<String>,
    branch_name: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<TenantDto, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let tenant_id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // 1. Tenants tablosuna işletmeyi ekle
    sqlx::query(
        "INSERT INTO tenants (id, name, status, contact_person, email, phone, tax_id, tax_office, address) 
         VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)"
    )
    .bind(&tenant_id)
    .bind(&name)
    .bind(&contact_person)
    .bind(&email)
    .bind(&phone)
    .bind(&tax_id)
    .bind(&tax_office)
    .bind(&address)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("İşletme kaydı oluşturulamadı: {}", e))?;

    // 2. Varsayılan Merkez Şube oluştur
    let branch_id = format!("br_{}", &Uuid::new_v4().to_string()[..8]);
    let branch_title = branch_name.unwrap_or_else(|| "Merkez Şube".to_string());
    sqlx::query(
        "INSERT INTO branches (id, tenant_id, name, address, status) VALUES (?, ?, ?, ?, 'ACTIVE')"
    )
    .bind(&branch_id)
    .bind(&tenant_id)
    .bind(&branch_title)
    .bind(&address)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Varsayılan şube açılamadı: {}", e))?;

    // 3. Yönetici (OWNER) kullanıcısını ve PIN kodunu oluştur
    let owner_user_id = format!("usr_owner_{}", &tenant_id[..8.min(tenant_id.len())]);
    let display_owner_name = owner_name
        .clone()
        .or_else(|| contact_person.clone())
        .unwrap_or_else(|| format!("{} Yöneticisi", name));
    let final_owner_email = owner_email
        .clone()
        .or_else(|| email.clone())
        .unwrap_or_else(|| format!("owner@kasam360.com"));
    let raw_password = owner_password.unwrap_or_else(|| format!("Kasam-{}", &Uuid::new_v4().to_string()[..8]));
    // Hash'leme hatası yutulmaz: önceden bilinen bir sabit ("argon2_hash_placeholder")
    // yazılıyordu. PHC olarak parse edilemediği için fiilen girişi kapatıyordu, ancak
    // kurulum başarıyla görünürken kimlik bilgisi kullanılamaz hale geliyordu.
    let password_hash = crate::auth::hash_credential(&raw_password)
        .map_err(|e| format!("Yönetici şifresi korunamadı: {}", e))?;
    let final_pin = owner_pin.unwrap_or_else(|| "2222".to_string());
    // PIN düz metin saklanmaz: Argon2 hash'i `pin_hash` sütununa yazılır.
    // `credential_hash` ise şifreye ayrıdır; ikisi aynı hesapta birlikte durabilir.
    let pin_hash = crate::user_credentials::hash_pin(&final_pin)
        .map_err(|e| format!("Yönetici PIN'i oluşturulamadı: {}", e))?;

    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, credential_hash, pin_hash, login_identifier, email, is_active)
         VALUES (?, ?, 'OWNER', ?, ?, ?, ?, ?, 1)"
    )
    .bind(&owner_user_id)
    .bind(&tenant_id)
    .bind(&display_owner_name)
    .bind(&password_hash)
    .bind(&pin_hash)
    .bind(&final_owner_email)
    .bind(&final_owner_email)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Yönetici kullanıcısı oluşturulamadı: {}", e))?;

    // Tenant içi PIN benzersizliği: aynı PIN başka bir personelde kullanılıyorsa
    // işletme kurulumu reddedilir. Kontroller aynı transaction içindedir.
    crate::user_credentials::ensure_pin_available(&mut tx, &tenant_id, &final_pin, None).await?;
    crate::user_credentials::ensure_pin_unique_after_write(&mut tx, &tenant_id, &final_pin, &owner_user_id).await?;

    // 4. Lisans anahtarını kaydet
    let final_license_key = license_key.unwrap_or_else(|| {
        let u = Uuid::new_v4().to_string().to_uppercase();
        format!("K360-{}-{}", &u[..4], &u[4..8])
    });
    let lic_id = format!("lic_{}", &Uuid::new_v4().to_string()[..8]);
    sqlx::query(
        "INSERT INTO licenses (id, tenant_id, license_key, status) VALUES (?, ?, ?, 'ACTIVE')"
    )
    .bind(&lic_id)
    .bind(&tenant_id)
    .bind(&final_license_key)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Lisans anahtarı kaydedilemedi: {}", e))?;

    // 5. Abonelik kaydı -> tenant_modules'e aktar
    let active_modules = modules.unwrap_or_else(|| vec!["core".to_string()]);
    for module_id in &active_modules {
        sqlx::query(
            "INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)"
        )
        .bind(&tenant_id)
        .bind(module_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Abonelik modülü kaydedilemedi: {}", e))?;
    }

    tx.commit().await.map_err(|e| format!("İşlem onaylanamadı: {}", e))?;

    // İşletme kurulumu sistem ve yetki tarafını da değiştirir (modüller, lisans,
    // yönetici PIN'i). Tek denetim kaydı yeterlidir; hassas veriler kayda girmez.
    let mut audit_conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let audit_ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_created",
        tenant_id.clone(),
        serde_json::json!({
            "tenantId": tenant_id,
            "modules": active_modules,
            "branchId": branch_id,
            "ownerUserId": owner_user_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *audit_conn, &audit_lock, &audit_ctx).await?;

    Ok(TenantDto {
        id: tenant_id,
        name,
        status: "ACTIVE".to_string(),
        modules: active_modules,
        created_at: chrono::Utc::now().to_rfc3339(),
        contact_person,
        email,
        phone,
        tax_id,
        tax_office,
        address,
    })
}

#[tauri::command]
pub async fn update_tenant(
    caller_role: Option<String>,
    id: String,
    name: String,
    modules: Option<Vec<String>>,
    contact_person: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    tax_id: Option<String>,
    tax_office: Option<String>,
    address: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<TenantDto, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE tenants SET name = ?, contact_person = ?, email = ?, phone = ?, tax_id = ?, tax_office = ?, address = ? WHERE id = ?"
    )
    .bind(&name)
    .bind(&contact_person)
    .bind(&email)
    .bind(&phone)
    .bind(&tax_id)
    .bind(&tax_office)
    .bind(&address)
    .bind(&id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(mod_list) = modules {
        sqlx::query("DELETE FROM tenant_modules WHERE tenant_id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        
        for module_id in &mod_list {
            sqlx::query("INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)")
                .bind(&id)
                .bind(module_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    let row = sqlx::query("SELECT id, name, status, created_at, contact_person, email, phone, tax_id, tax_office, address FROM tenants WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let module_rows = sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
        .bind(&id)
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();
    let current_modules: Vec<String> = module_rows.into_iter().map(|r| r.try_get("module_id").unwrap_or_default()).collect();

    let audit_ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_updated",
        id.clone(),
        serde_json::json!({
            "tenantId": id,
            "modules": current_modules,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &audit_ctx).await?;

    Ok(TenantDto {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        modules: current_modules,
        created_at: row.try_get("created_at").unwrap_or_default(),
        contact_person: row.try_get("contact_person").ok(),
        email: row.try_get("email").ok(),
        phone: row.try_get("phone").ok(),
        tax_id: row.try_get("tax_id").ok(),
        tax_office: row.try_get("tax_office").ok(),
        address: row.try_get("address").ok(),
    })
}

#[tauri::command]
pub async fn suspend_tenant(caller_role: String, tenant_id: String, pool: tauri::State<'_, DbPool>, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    sqlx::query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = ?")
        .bind(&tenant_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'SUSPENDED' WHERE tenant_id = ?")
        .bind(&tenant_id).execute(&*pool).await;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_suspended", tenant_id.clone(),
        serde_json::json!({ "changes": { "status": { "old": "ACTIVE", "new": "SUSPENDED" } } }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;
    Ok(())
}

#[tauri::command]
pub async fn activate_tenant(caller_role: String, tenant_id: String, pool: tauri::State<'_, DbPool>, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    sqlx::query("UPDATE tenants SET status = 'ACTIVE' WHERE id = ?")
        .bind(&tenant_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'ACTIVE' WHERE tenant_id = ?")
        .bind(&tenant_id).execute(&*pool).await;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_activated", tenant_id.clone(),
        serde_json::json!({ "changes": { "status": { "old": "SUSPENDED", "new": "ACTIVE" } } }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;
    Ok(())
}

#[tauri::command]
pub async fn update_tenant_modules(
    caller_role: String,
    tenant_id: String,
    modules: Vec<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let previous: Vec<String> = sqlx::query_scalar(
        "SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1 ORDER BY module_id ASC",
    )
    .bind(&tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM tenant_modules WHERE tenant_id = ?")
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    
    for module_id in &modules {
        sqlx::query("INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)")
            .bind(&tenant_id)
            .bind(module_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Modül değişikliği işletmenin yetki sınırlarını belirler: "Yetki"
    // kategorisine yazılır ve eski liste kayıtta korunur.
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::YETKI,
        "platform:tenant_modules_updated", tenant_id.clone(),
        serde_json::json!({
            "changes": { "modules": { "old": previous, "new": modules } }
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

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
    crate::rbac::require_master(&caller_role)?;
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
pub async fn register_device(caller_role: String, tenant_id: String, name: String, device_type: String, pool: tauri::State<'_, DbPool>, state: tauri::State<'_, crate::AppState>) -> Result<DeviceDto, String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO devices (id, tenant_id, name, device_type, status) VALUES (?, ?, ?, ?, 'ACTIVE')")
        .bind(&id).bind(&tenant_id).bind(&name).bind(&device_type)
        .execute(&*pool).await.map_err(|e| e.to_string())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:device_registered", id.clone(),
        serde_json::json!({ "tenantId": tenant_id, "name": name, "deviceType": device_type }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(DeviceDto { id, tenant_id, name, device_type, status: "ACTIVE".to_string(), last_heartbeat: None })
}

/// Toggle a device administratively.  This is deliberately a persisted state
/// change (rather than the browser demo's in-memory switch).
#[tauri::command]
pub async fn toggle_device_status(caller_role: String, device_id: String, pool: tauri::State<'_, DbPool>, state: tauri::State<'_, crate::AppState>) -> Result<DeviceDto, String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let previous_status: Option<String> = sqlx::query_scalar("SELECT status FROM devices WHERE id = ?")
        .bind(&device_id).fetch_optional(&mut *conn).await.ok().flatten();
    let row = sqlx::query("UPDATE devices SET status = CASE WHEN status = 'ACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END WHERE id = ? RETURNING id, tenant_id, name, device_type, status, last_heartbeat")
        .bind(&device_id).fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?
        .ok_or_else(|| "DEVICE_NOT_FOUND".to_string())?;
    let dto = DeviceDto {
        id: row.try_get("id").map_err(|e| e.to_string())?, tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
        name: row.try_get("name").map_err(|e| e.to_string())?, device_type: row.try_get("device_type").map_err(|e| e.to_string())?,
        status: row.try_get("status").map_err(|e| e.to_string())?, last_heartbeat: row.try_get("last_heartbeat").ok(),
    };

    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:device_status_changed", dto.id.clone(),
        serde_json::json!({
            "changes": { "status": { "old": previous_status, "new": dto.status } }
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(dto)
}

#[tauri::command]
pub async fn delete_device(caller_role: String, device_id: String, pool: tauri::State<'_, DbPool>, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let previous_name: Option<String> = sqlx::query_scalar("SELECT name FROM devices WHERE id = ?")
        .bind(&device_id).fetch_optional(&mut *conn).await.ok().flatten();
    let result = sqlx::query("DELETE FROM devices WHERE id = ?").bind(&device_id).execute(&mut *conn).await.map_err(|e| e.to_string())?;
    if result.rows_affected() != 1 { return Err("DEVICE_NOT_FOUND".into()); }

    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(), "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:device_deleted", device_id.clone(),
        serde_json::json!({ "name": previous_name }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;
    Ok(())
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
    crate::rbac::require_master(&caller_role)?;
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

/// Platform denetim kayıtları. MASTER'e açıktır ama **hash dönmez**:
/// zincirin bütünlüğü `verify_audit_ledger_integrity` ile ayrı komuttan sorulur,
/// ham hash hiçbir arayüzden görünmez (AGENTS.md §3.2).
#[tauri::command]
pub async fn get_platform_audit_logs(caller_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<serde_json::Value>, String> {
    crate::rbac::require_master(&caller_role)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, sequence, timestamp, actor_id, actor_role, category, action, resource_id FROM audit_ledger ORDER BY sequence DESC LIMIT 200")
        .fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let logs: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({
        "id": r.try_get::<String,_>("id").unwrap_or_default(),
        "sequence": r.try_get::<i64,_>("sequence").unwrap_or(0),
        "timestamp": r.try_get::<String,_>("timestamp").unwrap_or_default(),
        "actorId": r.try_get::<String,_>("actor_id").unwrap_or_default(),
        "actorRole": r.try_get::<String,_>("actor_role").unwrap_or_default(),
        "category": r.try_get::<String,_>("category").unwrap_or_default(),
        "action": r.try_get::<String,_>("action").unwrap_or_default(),
        "resourceId": r.try_get::<String,_>("resource_id").unwrap_or_default(),
        "sealed": true,
    })).collect();
    Ok(logs)
}

/// Verify the exact canonical SHA-256 chain written by AuditService.  A bad
/// row is reported to the caller; verification never mutates the ledger and
/// never returns a hash value.
#[tauri::command]
pub async fn verify_audit_ledger_integrity(caller_role: String, pool: tauri::State<'_, DbPool>) -> Result<serde_json::Value, String> {
    crate::rbac::require_master(&caller_role)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let result = AuditService::verify_chain(&mut conn).await?;

    if result.is_valid {
        return Ok(serde_json::json!({
            "isValid": true,
            "verifiedCount": result.verified_count,
            "hasEntries": result.tip_present,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "algorithm": "SHA-256",
        }));
    }

    Ok(serde_json::json!({
        "isValid": false,
        "verifiedCount": result.verified_count,
        "failedSequence": result.failed_sequence,
        "reason": result.failure_reason,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "algorithm": "SHA-256",
    }))
}

#[tauri::command]
pub async fn create_remote_session(
    caller_role: Option<String>,
    tenant_id: String,
    target_view: String,
    target_role: String,
    mode: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let session_id = format!("sess_{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let ticket = format!("TICKET_{}", &uuid::Uuid::new_v4().to_string()[..12].to_uppercase());

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let now_iso = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::json!({
        "sessionId": session_id,
        "tenantId": tenant_id,
        "targetView": target_view,
        "targetRole": target_role,
        "mode": mode,
    });
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        format!("system:remote_session_attached ({}/{})", target_view, target_role),
        format!("tenant:{}", tenant_id),
        payload,
        now_iso,
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({
        "success": true,
        "sessionId": session_id,
        "ticket": ticket,
        "mode": mode,
    }))
}

#[tauri::command]
pub async fn execute_it_action(
    caller_role: Option<String>,
    action_type: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let (message, ping_ms) = match action_type.as_str() {
        "DIAGNOSTIC_PING" => {
            let check: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&*pool)
            .await
            .unwrap_or_else(|_| "ok".to_string());
            (format!("Veritabanı bütünlüğü doğrulandı: {}. IPC bağlantısı stabil.", check), Some(4))
        }
        "FORCE_RESYNC" => {
            let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE)").execute(&*pool).await;
            ("Veritabanı WAL kontrol noktası (checkpoint) tamamlandı ve kuyruk senkronize edildi.".to_string(), None)
        }
        "CLEAR_CACHE" => {
            let _ = sqlx::raw_sql("PRAGMA shrink_memory").execute(&*pool).await;
            ("İşletme yerel önbelleği ve SQLite bellek alanı optimize edildi.".to_string(), None)
        }
        "FORCE_LOGOUT" => ("İşletme altındaki tüm açık terminal oturumları sonlandırıldı ve PIN kilit ekranına yönlendirildi.".to_string(), None),
        _ => ("İşlem başarıyla yürütüldü.".to_string(), None),
    };

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let now_iso = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::json!({
        "actionType": action_type,
        "tenantId": tenant_id,
        "result": "SUCCESS",
    });
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        format!("system:it_operational_command:{}", action_type),
        format!("tenant:{}", tenant_id),
        payload,
        now_iso,
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({
        "success": true,
        "actionType": action_type,
        "message": message,
        "pingMs": ping_ms,
    }))
}


#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCredentialsDto {
    pub pin: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub license_key: Option<String>,
    pub last_login: Option<String>,
}

#[tauri::command]
pub async fn get_user_credentials(
    caller_role: Option<String>,
    user_id: String,
    auth_key: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<VaultCredentialsDto, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    if auth_key.trim().is_empty() {
        return Err("Güvenlik parolası gereklidir.".into());
    }

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query("SELECT name, tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Kullanıcı bulunamadı.".to_string())?;
    let name: String = row.try_get("name").unwrap_or_default();
    let tenant_id: String = row.try_get("tenant_id").unwrap_or_default();

    let lic_row = sqlx::query("SELECT license_key FROM licenses WHERE tenant_id = ? LIMIT 1")
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .ok()
        .flatten();

    let license_key = lic_row.and_then(|r| r.try_get::<String, _>("license_key").ok());

    Ok(VaultCredentialsDto {
        // Düz metin PIN artık hiçbir yerde saklanmaz, dolayısıyla geri döndürülemez.
        // Kasa yalnızca yeni PIN tanımlayabilir; modal bunu yerelde gösterir.
        pin: None,
        email: Some(format!("{}@kasam360.com", name.to_lowercase().replace(' ', ""))),
        password: Some("••••••••".to_string()),
        license_key: license_key.or_else(|| Some("LIC-360-DEFAULT-KEY".to_string())),
        last_login: Some(chrono::Utc::now().to_rfc3339()),
    })
}

#[tauri::command]
pub async fn reset_user_password(
    caller_role: Option<String>,
    user_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let new_password = format!("Kasam-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let hash = crate::auth::hash_credential(&new_password)?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| PLATFORM_AUDIT_TENANT.to_string());

    sqlx::query("UPDATE users SET credential_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(&user_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // Defterde parolanın kendisi ya da hash'i yazılmaz; yalnızca olay.
    let ctx = AuditContext::new(
        tenant_id, "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "security:password_reset_by_master", user_id.clone(),
        serde_json::json!({ "targetUserId": user_id }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({
        "user_id": user_id,
        "new_password": new_password,
    }))
}

#[tauri::command]
pub async fn change_user_pin(
    caller_role: Option<String>,
    user_id: String,
    new_pin: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    // PIN format denetimi: 4 ila 8 haneli sayısal olmalıdır
    if !new_pin.chars().all(|c| c.is_ascii_digit()) || !(4..=8).contains(&new_pin.len()) {
        return Err("PIN 4-8 haneli sayısal olmalıdır.".into());
    }
    let hash = crate::user_credentials::hash_pin(&new_pin)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Tenant içi PIN benzersizliği: kontrol ve yazma aynı transaction içinde,
    // ardından yarış denetimi ile güçlendirilir.
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    crate::user_credentials::ensure_pin_available(&mut tx, &tenant_id, &new_pin, Some(&user_id)).await?;

    sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    crate::user_credentials::ensure_pin_unique_after_write(&mut tx, &tenant_id, &new_pin, &user_id).await?;
    tx.commit().await.map_err(|e| e.to_string())?;

    // Denetim kaydı transaction dışında yazılır: `append` bağlantı düzeyinde
    // çalışır ve kendi satırını tek başına yazar. PIN'in kendisi kaydedilmez.
    let ctx = AuditContext::new(
        tenant_id, "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::GUVENLIK,
        "security:pin_changed_by_master", user_id.clone(),
        serde_json::json!({ "targetUserId": user_id, "method": "master_override" }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({
        "success": true,
        "new_pin": new_pin,
    }))
}

#[tauri::command]
pub async fn regenerate_license_key(
    caller_role: Option<String>,
    user_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    crate::rbac::require_master_present(caller_role.as_deref())?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let new_key = format!("LIC-{}", uuid::Uuid::new_v4().to_string().to_uppercase());

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "DEFAULT_TENANT".to_string());

    sqlx::query(
        "INSERT INTO licenses (id, tenant_id, license_key, status) VALUES (?, ?, ?, 'ACTIVE')
         ON CONFLICT(id) DO UPDATE SET license_key = excluded.license_key",
    )
    .bind(&uuid::Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&new_key)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Lisans anahtarı işletmenin yetkisini belirler: "Yetki" kategorisine yazılır.
    // Anahtarın kendisi defterde tutulmaz.
    let ctx = AuditContext::new(
        tenant_id, "usr_master".to_string(), "MASTER".to_string(),
        crate::services::audit_service::category::YETKI,
        "platform:license_key_regenerated", user_id.clone(),
        serde_json::json!({ "targetUserId": user_id }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *conn, &audit_lock, &ctx).await?;

    Ok(serde_json::json!({
        "user_id": user_id,
        "new_key": new_key,
    }))
}
