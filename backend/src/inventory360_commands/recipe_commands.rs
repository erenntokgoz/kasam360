//! Reçete ve maliyet dökümü komutları (Spec §2.9).
//!
//! `feat_recipe_bom` bayrağı KAPALI iken tüm bu komutlar 404 döner: bayrak
//! kapalıyken reçete ekranı ve maliyet dökümü **yoktur**, "yetkin yok" değil.
//!
//! Rol kapısı: `OWNER` yazar, `MANAGER` okur. Reçete tanımı doğrudan kâr marjını
//! belirlediği için değiştirme sahibe aittir.
//!
//! Bilinmeyen maliyet `None`/`NULL` olarak döner; `0` yazılmaz. Bir ürünün
//! maliyeti bilinmiyorsa kâr marjı hesaplanamaz ve rapor bunu açıkça belirtir.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_recipe_bom, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::recipes;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecipeCostArgs {
    pub product_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeactivateRecipeArgs {
    pub recipe_id: String,
}

#[tauri::command]
pub async fn list_inventory_recipes(
    actor_role: String,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    include_inactive: Option<bool>,
    pool: State<'_, DbPool>,
) -> Result<Vec<recipes::Recipe>, String> {
    require_recipe_bom(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    recipes::list_recipes(&mut conn, &tenant_id, include_inactive.unwrap_or(false)).await
}

#[tauri::command]
pub async fn create_recipe_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: recipes::RecipeInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<recipes::Recipe, String> {
    require_recipe_bom(active_modules.as_ref())?;
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
    let result: Result<recipes::Recipe, String> = async {
        let recete = recipes::create_recipe(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "recete:created",
            &recete.id,
            serde_json::json!({ "productId": urun_id, "version": recete.version }),
        )
        .await?;

        Ok(recete)
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
pub async fn deactivate_recipe_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: DeactivateRecipeArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    require_recipe_bom(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        recipes::deactivate_recipe(&mut conn, &tenant_id, &args.recipe_id).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "recete:deactivated",
            &args.recipe_id,
            serde_json::json!({}),
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

/// Bir ürünün reçete maliyet dökümünü çözer.
///
/// Yanıt `unresolved` alanı boş değilse o bileşenlerin maliyeti bilinmiyor;
/// çağıran ekranda "maliyet bilinmiyor" göstermelidir, `0` göstermemelidir.
#[tauri::command]
pub async fn get_recipe_cost(
    actor_role: String,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: RecipeCostArgs,
    pool: State<'_, DbPool>,
) -> Result<recipes::RecipeCost, String> {
    require_recipe_bom(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    // Komut ürün kimliğiyle gelir, reçete kimliğiyle değil: ekranda seçilen malzemenin
    // aktif reçetesi çözülür. Doğrudan `calculate_recipe_cost` çağırmak her
    // istekte `NOT_FOUND: reçete bulunamadı` dönerdi, çünkü o yordam reçete
    // kimliği bekler.
    recipes::cost_for_active_recipe(&mut conn, &tenant_id, &args.product_id)
        .await?
        .ok_or_else(|| "NOT_FOUND: bu ürün için aktif reçete tanımlı değil".to_string())
}
