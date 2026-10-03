//! Sigorta poliçesi komutları (CRUD + süresi dolanlar).
//!
//! Rol kapısı: `OWNER` ve `MANAGER` okur, yalnız `OWNER` yazar.
//!
//! Neden müdür primi göremez diye bir kapı yok: müdür poliçe kaydını ve prim
//! tutarını görebilir (bütçe planlaması müdürün işidir). Kapatılan kapı
//! **yazma**dır — prim değiştirmek sigorta sözleşmesi değiştirmektir ve
//! sözleşmeyi değiştiren kişi sözleşmenin sahibi olmalıdır.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_FINANS};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::insurance::{
    get_expiring_policies, list_policies, save_policy, InsurancePolicy, PolicyInput,
};

#[tauri::command]
pub async fn list_policies_command(
    actor_role: String,
    tenant_id: Option<String>,
    policy_type: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<InsurancePolicy>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_policies(&mut conn, &tenant_id, policy_type.as_deref()).await
}

#[tauri::command]
pub async fn get_expiring_policies_command(
    actor_role: String,
    tenant_id: Option<String>,
    window_days: Option<i64>,
    pool: State<'_, DbPool>,
) -> Result<Vec<InsurancePolicy>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    get_expiring_policies(&mut conn, &tenant_id, window_days.unwrap_or(30)).await
}

#[tauri::command]
pub async fn save_policy_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: PolicyInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<InsurancePolicy, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<InsurancePolicy, String> = async {
        let polica = save_policy(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            "sigorta:polica_saved",
            &polica.id,
            serde_json::json!({
                "policyType": polica.policy_type,
                "policyNumber": polica.policy_number,
                "premiumCents": polica.premium_cents,
                "expiryDate": polica.expiry_date,
            }),
        )
        .await?;

        Ok(polica)
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
