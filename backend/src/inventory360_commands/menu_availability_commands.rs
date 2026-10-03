//! Menü görünürlüğü ve dinamik tarife komutları (Spec §2.11).
//!
//! Bu dosya iki konuyu bir araya toplar: **ne zaman görünür** (dinamik tarife
//! kuralı, öğle/akşam menü penceresi) ve **hangi pencerede** (`set_product_active_window`).
//! İkisi de ürünün kasada görünürlüğünü belirler; ayrı dosyalara bölmek aynı
//! kararın iki yerden yazılmasına yol açar.
//!
//! Bayrak ayrımı: `feat_dynamic_pricing` KAPALI iken yalnız dinamik kural
//! komutları 404 döner. Menü penceresi bu bayrağa bağlı **değildir**; pencere
//! zamana bağlı menüdür, indirim değildir ve her işletmede kullanılır.
//!
//! Rol kapısı: menü penceresini `MANAGER` da açıp kapatabilir (vardiya kararı);
//! dinamik kural yalnız `OWNER`'dır çünkü doğrudan gelir düşürür.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_dynamic_pricing, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::pricing;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetWindowProductArgs {
    pub window_id: String,
    pub product_id: String,
    pub is_available: bool,
}

#[tauri::command]
pub async fn get_pricing_rules(
    actor_role: String,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
) -> Result<Vec<pricing::PricingRule>, String> {
    require_dynamic_pricing(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    pricing::list_pricing_rules(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn upsert_pricing_rule_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    args: pricing::PricingRuleInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<pricing::PricingRule, String> {
    require_dynamic_pricing(active_modules.as_ref())?;
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let kural_adi = args.name.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<pricing::PricingRule, String> = async {
        let kural = pricing::upsert_pricing_rule(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "tarife:rule_saved",
            &kural.id,
            serde_json::json!({
                "name": kural_adi,
                "discountPercent": kural.discount_percent,
            }),
        )
        .await?;

        Ok(kural)
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
pub async fn get_service_windows(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<pricing::ServiceWindow>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    pricing::list_service_windows(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn upsert_service_window_command(
    actor_role: String,
    tenant_id: Option<String>,
    args: pricing::ServiceWindowInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<pricing::ServiceWindow, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(None, &actor_role);
    let pencere_adi = args.name.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<pricing::ServiceWindow, String> = async {
        let pencere = pricing::upsert_service_window(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "menu:window_saved",
            &pencere.id,
            serde_json::json!({ "name": pencere_adi }),
        )
        .await?;

        Ok(pencere)
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
pub async fn set_menu_window_product(
    actor_role: String,
    tenant_id: Option<String>,
    args: SetWindowProductArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(None, &actor_role);
    let urun_id = args.product_id.clone();
    let musait = args.is_available;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        pricing::set_window_product(&mut conn, &tenant_id, &args.window_id, &urun_id, musait)
            .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "menu:window_product_set",
            &urun_id,
            serde_json::json!({ "windowId": args.window_id, "isAvailable": musait }),
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

#[tauri::command]
pub async fn set_product_active_window(
    actor_role: String,
    tenant_id: Option<String>,
    product_id: String,
    window_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let sonuc: Result<(), String> = async {
        let hedef: Option<String> = match window_id.as_deref() {
            Some(bos) if !bos.trim().is_empty() => {
                sqlx::query_scalar(
                    "SELECT id FROM menu_service_windows WHERE id = ? AND tenant_id = ?",
                )
                .bind(bos.trim())
                .bind(&tenant_id)
                .fetch_optional(&mut conn)
                .await
                .map_err(|e| e.to_string())?
            }
            Some(_) => None,
            None => {
                crate::management_commands::ensure_owned(
                    &mut conn,
                    "products",
                    &product_id,
                    &tenant_id,
                )
                .await?;
                None
            }
        };

        if let Some(pencere) = &hedef {
            sqlx::query(
                "INSERT INTO menu_window_products (id, tenant_id, window_id, product_id, is_available)
                 VALUES (?, ?, ?, ?, 1)",
            )
            .bind(crate::id_generator::generate_id("mwp"))
            .bind(&tenant_id)
            .bind(pencere)
            .bind(&product_id)
            .execute(&mut conn)
            .await
            .map_err(|e| e.to_string())?;
        }

        // Pencereyi kaldırmak "pencere yok" demektir; `None` yazılır.
        sqlx::query(
            "UPDATE products SET service_window_id = ? WHERE id = ? AND tenant_id = ?",
        )
        .bind(hedef)
        .bind(&product_id)
        .bind(&tenant_id)
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;

    match sonuc {
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
