//! Raf ömrü ve son kullanma takibi komutları (Spec §2.13).
//!
//! Rol kapısı: `OWNER` politika yazar, `MANAGER` okur ve parti tarihi düzeltir.
//! Tarih düzeltmesi elle girildiği için 86'lanan ürünü kurtarmak için gereklidir;
//! yine de müdahale denetim defterine yazılır.
//!
//! Bayrak: bu komutlar `feat_loss_radar` ile açılır. Kapalıyken son kullanma
//! takibi yapılmaz, dolayısıyla komut da 404 döner.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_loss_radar, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::{shelf_life, ShelfLifePolicyInput};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetBatchExpiryArgs {
    pub batch_id: String,
    pub expiry_date: String,
}

#[tauri::command]
pub async fn get_expiry_report(
    actor_role: String,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
) -> Result<shelf_life::ExpiryReport, String> {
    require_loss_radar(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    shelf_life::expiring_batches(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn list_shelf_life_policies_command(
    actor_role: String,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
) -> Result<Vec<shelf_life::ShelfLifePolicy>, String> {
    require_loss_radar(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    shelf_life::list_shelf_life_policies(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn upsert_shelf_life_policy_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: ShelfLifePolicyInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<shelf_life::ShelfLifePolicy, String> {
    require_loss_radar(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let urun_id = args.product_id.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<shelf_life::ShelfLifePolicy, String> = async {
        let politika = shelf_life::upsert_shelf_life_policy(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "raf:policy_saved",
            &politika.id,
            serde_json::json!({
                "productId": urun_id,
                "shelfLifeDays": politika.shelf_life_days,
                "warningDays": politika.warning_days,
            }),
        )
        .await?;

        Ok(politika)
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

#[tauri::command]
pub async fn set_batch_expiry_date(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: SetBatchExpiryArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    require_loss_radar(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let tarih = args.expiry_date.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        shelf_life::set_batch_expiry(&mut conn, &tenant_id, &args.batch_id, &tarih).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::FINANS,
            "raf:batch_expiry_set",
            &args.batch_id,
            serde_json::json!({ "expiryDate": tarih }),
        )
        .await?;

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}
