//! Müzik telif lisansı komutları (CRUD + süresi dolanlar).
//!
//! Rol kapısı: `OWNER` ve `MANAGER` okur, yalnız `OWNER` yazar.
//!
//! Telif bedeli bir borçtur; lisans kaydı bu borcun resmî belgesidir. Borcu
//! değiştiren kaydı işletme sahibi değiştirir.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_FINANS};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::music_license::{
    get_expiring_licenses, list_licenses, save_license, MusicLicense, MusicLicenseInput,
};

#[tauri::command]
pub async fn list_music_licenses_command(
    actor_role: String,
    tenant_id: Option<String>,
    year: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<MusicLicense>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_licenses(&mut conn, &tenant_id, year).await
}

#[tauri::command]
pub async fn get_expiring_licenses_command(
    actor_role: String,
    tenant_id: Option<String>,
    window_days: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<MusicLicense>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    get_expiring_licenses(&mut conn, &tenant_id, window_days.unwrap_or(30)).await
}

#[tauri::command]
pub async fn save_music_license_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: MusicLicenseInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<MusicLicense, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<MusicLicense, String> = async {
        let lisans = save_license(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            "telif:lisans_saved",
            &lisans.id,
            serde_json::json!({
                "licenseType": lisans.license_type,
                "year": lisans.year,
                "amountCents": lisans.amount_cents,
                "expiryDate": lisans.expiry_date,
            }),
        )
        .await?;

        Ok(lisans)
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
