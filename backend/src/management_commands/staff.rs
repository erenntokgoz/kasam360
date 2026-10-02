//! Personel yönetimi komutları: listeleme, atama ve pasife alma.
//!
//! Personel kaydı silinmez (AGENTS.md §6); pasife alınır. Kayıt geçmiş
//! sipariş ve vardiya satırlarının referansı olduğu için fiziksel olarak
//! korunur.

use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row};

use super::{audit_actor, ensure_owned, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StaffMemberDto {
    pub id: String,
    pub name: String,
    pub role: String,
    pub tenant_id: String,
}

#[tauri::command]
pub async fn get_staff(
    actor_role: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<StaffMemberDto>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Pasife alınmış personel listelenmez: kayıt silinmez ama işletme panosunda
    // görünmez. Yeniden canlandırma bu fazın kapsamı dışında.
    let rows = sqlx::query("SELECT id, name, role, tenant_id FROM users WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC")
        .bind(&tenant_id).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    let staff = rows
        .into_iter()
        .map(|r| {
            Ok(StaffMemberDto {
                id: r.try_get("id").map_err(|e| e.to_string())?,
                name: r.try_get("name").map_err(|e| e.to_string())?,
                role: r.try_get("role").map_err(|e| e.to_string())?,
                tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<StaffMemberDto>, String>>()?;
    Ok(staff)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_staff_member(
    actor_role: String, tenant_id: Option<String>, name: String,
    role: String, pin: String, actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>, app_state: tauri::State<'_, crate::AppState>
) -> Result<StaffMemberDto, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
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
        category::PERSONEL,
        "staff:created", &id,
        serde_json::json!({ "name": name, "assignedRole": role }),
    ).await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(StaffMemberDto { id, name, role, tenant_id })
}

#[tauri::command]
pub async fn delete_staff_member(
    actor_role: String, staff_id: String, actor_id: Option<String>,
    tenant_id: Option<String>,
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
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    ensure_owned(&mut conn, "users", &staff_id, &tenant_id).await?;

    let previous: Option<(String, String)> = sqlx::query_as("SELECT name, role FROM users WHERE id = ? AND tenant_id = ?")
        .bind(&staff_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let result = sqlx::query("UPDATE users SET is_active = 0 WHERE id = ? AND tenant_id = ?")
        .bind(&staff_id).bind(&tenant_id)
        .execute(&mut *conn).await.map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Kullanıcı bulunamadı.".into());
    }

    // `ensure_owned` kaydın varlığını doğruladı; burada satır yoksa sadece
    // yarış koşulu (eşzamanlı silme) geçerlidir ve ad bilgisi bilinmez.
    let (staff_name, staff_role) = previous
        .map(|(n, r)| (serde_json::json!(n), serde_json::json!(r)))
        .unwrap_or((serde_json::Value::Null, serde_json::Value::Null));
    record_audit(
        &mut conn, &lock, &tenant_id, &actor_id, &actor_role,
        category::PERSONEL,
        "staff:deactivated", &staff_id,
        serde_json::json!({
            "name": staff_name,
            "role": staff_role,
            "changes": { "isActive": { "old": true, "new": false } },
        }),
    ).await?;

    Ok(())
}
