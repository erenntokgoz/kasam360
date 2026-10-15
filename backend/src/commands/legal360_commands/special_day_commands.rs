//! Özel gün komutları (CRUD + yaklaşan günler).
//!
//! Rol kapısı: `OWNER` ve `MANAGER` okur, yalnız `OWNER` yazar.
//!
//! Yazma neden sahibe sınırlı: `discount_percent` doğrudan fiyat ve dolayısıyla
//! ciro etkisidir. Müdür kampanyanın günlük akışını görebilir, tarifeyi
//! değiştiremez.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_MENU};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::special_days::{
    list_special_days, list_upcoming_special_days, save_special_day, SpecialDay, SpecialDayInput,
};

#[tauri::command]
pub async fn list_special_days_command(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<SpecialDay>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_special_days(&mut conn, &tenant_id).await
}

/// Yaklaşan günler ve her biri için "hazırlığa kaç gün kaldı" bilgisi.
#[tauri::command]
pub async fn list_upcoming_special_days_command(
    actor_role: String,
    tenant_id: Option<String>,
    window_days: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<(SpecialDay, String, i64)>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_upcoming_special_days(&mut conn, &tenant_id, window_days.unwrap_or(30)).await
}

#[tauri::command]
pub async fn save_special_day_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: SpecialDayInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<SpecialDay, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<SpecialDay, String> = async {
        let gun = save_special_day(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_MENU,
            "ozelgun:saved",
            &gun.id,
            serde_json::json!({
                "name": gun.name,
                "date": gun.date,
                "discountPercent": gun.discount_percent,
                "recurringYearly": gun.recurring_yearly,
            }),
        )
        .await?;

        Ok(gun)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}
