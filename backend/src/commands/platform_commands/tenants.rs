//! Platform kiracı yönetimi komutları.
//!
//! Neden ayrı dosya: platform_commands.rs dosyasının 500 satır tavanını
//! aşmasını önlemek için mantıksal alt modüle bölündü.

use super::PLATFORM_AUDIT_TENANT;
use crate::db::DbPool;
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

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
pub async fn get_tenants(
    caller_role: String,
    caller_tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<TenantDto>, String> {
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
        let module_rows = sqlx::query(
            "SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1",
        )
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .unwrap_or_default();
        let modules: Vec<String> = module_rows
            .into_iter()
            .map(|r| r.try_get("module_id").unwrap_or_default())
            .collect();

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
        "INSERT INTO branches (id, tenant_id, name, address, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
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
        .unwrap_or_else(|| "owner@kasam360.com".to_string());
    // Yönetici parolası verilmezse üretilir.
    let raw_password = match owner_password {
        Some(verilen) => verilen,
        None => format!("K3s-{}", crate::services::security360::rastgele_parola(20)),
    };
    crate::services::security360::policy::parola_dogrula(&raw_password, Some(&final_owner_email))
        .map_err(|e| format!("Yönetici parolası kabul edilmedi: {e}"))?;
    let password_hash = crate::auth::hash_credential(&raw_password)
        .map_err(|e| format!("Yönetici şifresi korunamadı: {}", e))?;
    let final_pin = owner_pin.unwrap_or_else(|| "2222".to_string());
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
    crate::user_credentials::ensure_pin_unique_after_write(
        &mut tx,
        &tenant_id,
        &final_pin,
        &owner_user_id,
    )
    .await?;

    // 4. Lisans anahtarını kaydet
    let final_license_key = license_key.unwrap_or_else(|| {
        let u = Uuid::new_v4().to_string().to_uppercase();
        format!("K360-{}-{}", &u[..4], &u[4..8])
    });
    let lic_id = format!("lic_{}", &Uuid::new_v4().to_string()[..8]);
    sqlx::query(
        "INSERT INTO licenses (id, tenant_id, license_key, status) VALUES (?, ?, ?, 'ACTIVE')",
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
            "INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)",
        )
        .bind(&tenant_id)
        .bind(module_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Abonelik modülü kaydedilemedi: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("İşlem onaylanamadı: {}", e))?;

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
    AuditService::append(&mut audit_conn, &audit_lock, &audit_ctx).await?;

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
            sqlx::query(
                "INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)",
            )
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

    let module_rows =
        sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
            .bind(&id)
            .fetch_all(&mut *conn)
            .await
            .unwrap_or_default();
    let current_modules: Vec<String> = module_rows
        .into_iter()
        .map(|r| r.try_get("module_id").unwrap_or_default())
        .collect();

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
    AuditService::append(&mut conn, &audit_lock, &audit_ctx).await?;

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
pub async fn suspend_tenant(
    caller_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    sqlx::query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = ?")
        .bind(&tenant_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'SUSPENDED' WHERE tenant_id = ?")
        .bind(&tenant_id)
        .execute(&*pool)
        .await;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_suspended",
        tenant_id.clone(),
        serde_json::json!({ "changes": { "status": { "old": "ACTIVE", "new": "SUSPENDED" } } }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;
    Ok(())
}

#[tauri::command]
pub async fn activate_tenant(
    caller_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_master(&caller_role)?;
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    sqlx::query("UPDATE tenants SET status = 'ACTIVE' WHERE id = ?")
        .bind(&tenant_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    let _ = sqlx::query("UPDATE subscriptions SET status = 'ACTIVE' WHERE tenant_id = ?")
        .bind(&tenant_id)
        .execute(&*pool)
        .await;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::SISTEM,
        "system:tenant_activated",
        tenant_id.clone(),
        serde_json::json!({ "changes": { "status": { "old": "SUSPENDED", "new": "ACTIVE" } } }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;
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
        sqlx::query(
            "INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES (?, ?, 1)",
        )
        .bind(&tenant_id)
        .bind(module_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Modül değişikliği işletmenin yetki sınırlarını belirler: "Yetki"
    // kategorisine yazılır ve eski liste kayıtta korunur.
    let ctx = AuditContext::new(
        PLATFORM_AUDIT_TENANT.to_string(),
        "usr_master".to_string(),
        "MASTER".to_string(),
        crate::services::audit_service::category::YETKI,
        "platform:tenant_modules_updated",
        tenant_id.clone(),
        serde_json::json!({
            "changes": { "modules": { "old": previous, "new": modules } }
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut conn, &audit_lock, &ctx).await?;

    Ok(())
}
