//! Kimlik doğrulama komutları (PIN, kullanıcı, şifre değişimi)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};


use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};

static FAILED_PIN_ATTEMPTS: AtomicU32 = AtomicU32::new(0);
static PIN_LOCKED_UNTIL: AtomicI64 = AtomicI64::new(0);

fn check_pin_rate_limit() -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let locked_until = PIN_LOCKED_UNTIL.load(Ordering::Relaxed);
    if now < locked_until {
        let remaining_secs = locked_until - now;
        return Err(format!(
            "RATE_LIMIT_EXCEEDED: Güvenlik nedeniyle terminal kilitlendi. Lütfen {} saniye sonra tekrar deneyin.",
            remaining_secs
        ));
    }
    Ok(())
}

fn record_failed_pin() {
    let attempts = FAILED_PIN_ATTEMPTS.fetch_add(1, Ordering::Relaxed) + 1;
    if attempts >= 5 {
        let lock_until = chrono::Utc::now().timestamp() + 300; // 5 dakika (300 saniye)
        PIN_LOCKED_UNTIL.store(lock_until, Ordering::Relaxed);
        FAILED_PIN_ATTEMPTS.store(0, Ordering::Relaxed);
    }
}

fn record_successful_pin() {
    FAILED_PIN_ATTEMPTS.store(0, Ordering::Relaxed);
    PIN_LOCKED_UNTIL.store(0, Ordering::Relaxed);
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UserDto {
    pub id: String,
    pub role: String,
    pub name: String,
    pub tenant_id: String,
    #[serde(rename = "activeModules", skip_serializing_if = "Option::is_none")]
    pub active_modules: Option<Vec<String>>,
}

async fn user_dto_with_modules(pool: &DbPool, row: &sqlx::sqlite::SqliteRow) -> UserDto {
    let tenant_id: String = row.try_get("tenant_id").unwrap_or_else(|_| "DEFAULT_TENANT".to_string());
    let module_rows = sqlx::query("SELECT module_id FROM tenant_modules WHERE tenant_id = ? AND is_active = 1")
        .bind(&tenant_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    let active_modules: Vec<String> = module_rows
        .into_iter()
        .map(|r| r.try_get("module_id").unwrap_or_default())
        .collect();

    UserDto {
        id: row.try_get("id").unwrap_or_default(),
        role: row.try_get("role").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        tenant_id,
        active_modules: Some(active_modules),
    }
}

/// Authenticates an exact, provisioned login identifier.  Names and roles are
/// deliberately not identifiers: neither is stable nor secret.
pub async fn authenticate_by_identifier(pool: &DbPool, identifier: &str, secret: &str) -> Result<UserDto, String> {
    let identifier = identifier.trim();
    if identifier.is_empty() || secret.is_empty() {
        return Err("Geçersiz kimlik bilgileri".to_string());
    }

    // İlk olarak platform_admins tablosuna bak (MASTER yetkisi için).
    // Sütun `pin_hash`: düz metin `pin` kaldırıldı, yalnızca Argon2id PHC kabul edilir.
    let admin_row = sqlx::query(
        "SELECT id, name, pin_hash FROM platform_admins WHERE email = ? COLLATE NOCASE",
    )
    .bind(identifier)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = admin_row {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(secret, hash),
            None => false,
        };

        if is_valid {
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: "DEFAULT_TENANT".to_string(),
                active_modules: Some(vec![
                    "feat_kds".into(), "feat_qr_menu".into(), "feat_delivery".into(),
                    "feat_caller_id".into(), "feat_table_order".into(), "feat_seat_split".into(),
                    "feat_recipe_bom".into(), "feat_dynamic_pricing".into(), "feat_ledger_cari".into(),
                    "feat_multi_branch".into(), "feat_loss_radar".into(),
                ]),
            });
        }
    }

    let row = sqlx::query(
        "SELECT id, role, name, tenant_id, credential_hash FROM users WHERE is_active = 1 AND (login_identifier = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR id = ?)",
    )
    .bind(identifier)
    .bind(identifier)
    .bind(identifier)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        return Err("Geçersiz kimlik bilgileri".to_string());
    };
    // Yalnızca Argon2 hash'i kabul edilir; düz metin PIN sütunu artık yoktur ve
    // migration'da hash'e çevrilmiştir. Argon2 olmayan bir hash "eşleşme" sayılmaz.
    let hash: Option<String> = row.try_get("credential_hash").ok().flatten();
    let is_valid = match hash.as_deref() {
        Some(hash) if crate::user_credentials::is_argon2_hash(hash) => {
            crate::auth::verify_credential(secret, hash)
        }
        _ => false,
    };

    if !is_valid {
        return Err("Geçersiz kimlik bilgileri".to_string());
    }
    Ok(user_dto_with_modules(pool, &row).await)
}

/// PIN entry remains supported for restaurant workstations.  PINs are checked
/// against salted Argon2 hashes when available, with safe fallback to provisioned PINs.
/// PIN ile kimlik doğrulama — Restoran çalışma istasyonları için.
/// Multi-tenant izolasyonu: Eğer tenant_id belirtilmişse, öncelikle o işletmeye ait personel aranır.
pub async fn authenticate_by_pin(pool: &DbPool, pin: &str, target_tenant_id: Option<&str>) -> Result<UserDto, String> {
    // PIN brute force koruması
    check_pin_rate_limit()?;

    // PIN uzunluğu en az 4, en fazla 8 hane ve tamamen rakamlardan oluşmalıdır
    if !pin.chars().all(|character| character.is_ascii_digit()) || !(4..=8).contains(&pin.len()) {
        record_failed_pin();
        return Err("Geçersiz PIN".to_string());
    }

    // İlk olarak platform_admins kontrol et (MASTER her işletmede geçerlidir).
    // `pin_hash` sütunu Argon2id tutar; düz metin karşılaştırması yoktur.
    let admin_rows = sqlx::query("SELECT id, name, pin_hash FROM platform_admins")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    for row in admin_rows {
        let hash: Option<String> = row.try_get("pin_hash").ok().flatten();
        let is_valid = match hash.as_deref() {
            Some(hash) => crate::user_credentials::verify_stored_credential(pin, hash),
            None => false,
        };

        if is_valid {
            record_successful_pin();
            return Ok(UserDto {
                id: row.try_get("id").unwrap_or_default(),
                role: "MASTER".to_string(),
                name: row.try_get("name").unwrap_or_default(),
                tenant_id: target_tenant_id.unwrap_or("DEFAULT_TENANT").to_string(),
                active_modules: Some(vec![
                    "feat_kds".into(), "feat_qr_menu".into(), "feat_delivery".into(),
                    "feat_caller_id".into(), "feat_table_order".into(), "feat_seat_split".into(),
                    "feat_recipe_bom".into(), "feat_dynamic_pricing".into(), "feat_ledger_cari".into(),
                    "feat_multi_branch".into(), "feat_loss_radar".into(),
                ]),
            });
        }
    }

    // Multi-tenant PIN çakışmasını engelle (Cross-Tenant PIN Fallthrough Koruması):
    // tenant belirtilmişse yalnızca o tenant taranır, bulunamazsa hiçbir başka
    // kiracıya düşülmez. Tenant belirtilmemişse yalnızca DEFAULT_TENANT denenir —
    // bu, tüm veritabanını taramakla aynı şey değildir.
    let effective_tenant = match target_tenant_id {
        Some(tenant) if !tenant.is_empty() => tenant,
        _ => "DEFAULT_TENANT",
    };

    // PIN düz metin olmadığı için `WHERE pin = ?` yerine aday satırlar Argon2 ile
    // doğrulanır. Bu tarama `user_credentials` içinde tek yerde yaşar.
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let matched = crate::user_credentials::find_user_by_pin(&mut conn, pin, Some(effective_tenant)).await?;
    drop(conn);

    match matched {
        Some(found) => {
            record_successful_pin();
            let row = sqlx::query("SELECT id, role, name, tenant_id FROM users WHERE id = ?")
                .bind(&found.id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(user_dto_with_modules(pool, &row).await)
        }
        None => {
            record_failed_pin();
            Err("Geçersiz PIN".to_string())
        }
    }
}

#[tauri::command]
pub async fn auth_login_credentials(identifier: String, secret: String, pool: tauri::State<'_, DbPool>) -> Result<UserDto, String> {
    authenticate_by_identifier(&pool, &identifier, &secret).await
}

#[tauri::command]
pub async fn auth_login(
    pin: String,
    tenant_id: Option<String>,
    #[allow(non_snake_case)]
    tenantId: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<UserDto, String> {
    let effective_tenant = tenant_id.or(tenantId);
    authenticate_by_pin(&pool, &pin, effective_tenant.as_deref()).await
}

#[tauri::command]
pub async fn change_self_pin(
    user_id: String,
    current_pin: Option<String>,
    new_pin: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    // PIN 4 ila 8 haneli sayısal olmalıdır
    if !new_pin.chars().all(|c| c.is_ascii_digit()) || !(4..=8).contains(&new_pin.len()) {
        return Err("Yeni PIN 4-8 haneli sayısal olmalıdır.".into());
    }

    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // Mevcut PIN gönderilmişse Argon2 üzerinden doğrula.
    if let Some(ref cur_pin) = current_pin {
        if !crate::user_credentials::verify_user_pin(&mut conn, &user_id, cur_pin).await? {
            return Err("Mevcut PIN hatalı.".to_string());
        }
    }

    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    // Yeni PIN'i hash'le ve yalnızca hash'ini yaz: düz metin hiçbir yere gitmez.
    let hash = crate::user_credentials::hash_pin(&new_pin)?;

    // PIN benzersizliği kontrolü ve yazma aynı transaction içinde.
    let tenant_id: String = sqlx::query_scalar("SELECT tenant_id FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    crate::user_credentials::ensure_pin_available(&mut *tx, &tenant_id, &new_pin, Some(&user_id)).await?;

    sqlx::query("UPDATE users SET pin_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    crate::user_credentials::ensure_pin_unique_after_write(&mut *tx, &tenant_id, &new_pin, &user_id).await?;

    // Kimlik bilgisi değişikliği "Güvenlik" kategorisine yazılır. Deftere PIN'in
    // kendisi ya da hash'i girmez; yalnızca değişikliğin gerçekleştiği yazılır.
    let user_role: String =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or_else(|_| "System".to_string());

    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id,
        user_id.clone(),
        user_role,
        crate::services::audit_service::category::GUVENLIK,
        "security:pin_changed",
        user_id.clone(),
        serde_json::json!({ "userId": user_id, "method": "self_service" }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "user_id": user_id,
        "new_pin": new_pin,
    }))
}
