//! Fiyat çözümleme, 86'd, fiyat listesi, fiyat dondurma ve toplu güncelleme
//! komutları (Spec §2.11).
//!
//! Bu dosyada **fiyatın kendisi** yazılır. Ürünün ne zaman görüneceği (dinamik
//! tarife, menü penceresi) `menu_availability_commands` içindedir; ikisi farklı
//! kararlardır ve aynı dosyada yazılırsa bayrak kapısı birbirine karışır.
//!
//! `feat_dynamic_pricing` bayrağı bu dosyaya **bağlı değildir**: fiyat listesi,
//! dondurma, toplu güncelleme ve 86'd her işletmede çalışır. Kasada fiyat
//! çözümlemesi bayraktan bağımsız olduğu için dondurma taahhüdü her zaman
//! uygulanır.
//!
//! Rol kapısı: fiyat yazan her komut `OWNER`'dır. `MANAGER` fiyatı ve
//! dondurmayı değiştiremez.
//!
//! Fiyat dondurma P0 güvenlik kilididir: donmuş fiyat, zam gelse bile kasada
//! korunur. Bu yüzden dondurma yazımı denetim defterine girer ve toplu
//! güncelleme donmuş ürünü sessizce atlamaz, raporda listeler.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::{category, AuditLock};
use crate::services::inventory360::pricing;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePriceArgs {
    pub product_id: String,
    pub price_list_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetProduct86Args {
    pub product_id: String,
    pub is_86d: bool,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn get_effective_price(
    actor_role: String,
    tenant_id: Option<String>,
    args: EffectivePriceArgs,
    pool: State<'_, DbPool>,
) -> Result<pricing::EffectivePrice, String> {
    rbac::require_any(
        &actor_role,
        &[Role::Owner, Role::Manager, Role::Cashier, Role::Waiter],
    )?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    pricing::effective_price(&mut conn, &tenant_id, &args.product_id, None).await
}

#[tauri::command]
pub async fn set_product_86d_command(
    actor_role: String,
    tenant_id: Option<String>,
    args: SetProduct86Args,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<bool, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(None, &actor_role);
    let urun_id = args.product_id.clone();
    let is_86d = args.is_86d;
    let gerekce = args.reason.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<bool, String> = async {
        let deger = pricing::set_product_86d(
            &mut conn,
            &tenant_id,
            &actor_id,
            &urun_id,
            is_86d,
            gerekce.clone(),
        )
        .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "menu:product_86d",
            &urun_id,
            serde_json::json!({ "is86d": is_86d, "reason": gerekce }),
        )
        .await?;

        Ok(deger)
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
pub async fn bulk_update_product_prices(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: pricing::BulkPriceInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<pricing::BulkPriceResult, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<pricing::BulkPriceResult, String> = async {
        let sonuc = pricing::bulk_update_prices(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "menu:bulk_price_update",
            "toplu",
            serde_json::json!({
                "changedCount": sonuc.changed.len(),
                "skippedCount": sonuc.skipped.len(),
            }),
        )
        .await?;

        Ok(sonuc)
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
pub async fn create_price_freeze_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: pricing::PriceFreezeInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<String, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let urun_id = args.product_id.clone();
    let donmus_fiyat = args.frozen_price_cents;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<String, String> = async {
        let id = pricing::create_price_freeze(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "fiyat:frozen",
            &id,
            serde_json::json!({ "productId": urun_id, "frozenPriceCents": donmus_fiyat }),
        )
        .await?;

        Ok(id)
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
pub async fn list_price_lists(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<pricing::PriceList>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    pricing::list_price_lists(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn create_price_list_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: pricing::PriceListInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<pricing::PriceList, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let liste_adi = args.name.clone();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<pricing::PriceList, String> = async {
        let liste = pricing::create_price_list(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "fiyat:list_created",
            &liste.id,
            serde_json::json!({ "name": liste_adi, "itemCount": liste.items.len() }),
        )
        .await?;

        Ok(liste)
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
pub async fn delete_price_list_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<(), String> {
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
        pricing::delete_price_list(&mut conn, &tenant_id, &id).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            category::MENU,
            "fiyat:list_deleted",
            &id,
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
