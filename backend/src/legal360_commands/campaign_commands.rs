//! Kampanya komutları (CRUD, kupon, uygulama, istatistik).
//!
//! Rol kapısı: `OWNER` ve `MANAGER` okur, yalnız `OWNER` yazar.
//!
//! Kupon uygulama komutu kasada **müdür tarafından da** çağrılabilir: indirim
//! uygulamak satış anı kararıdır ve kasada bekleyen müşteriyi bekletmemek
//! müdürün görevidir. Yazma yine de OWNER'dır — kuponun kendisini oluşturmak
//! ile mevcut kuponu kullanmak farklı yetkilerdir: kupon tanımı gelir etkisi
//! yaratır, kupon kullanımı yalnız mevcut bir indirimi kasa üzerinden geçirir.
//! Bu yüzden yalnız `apply_campaign_command` MANAGER'a açıktır.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_FINANS, KATEGORI_MENU};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::campaigns::{
    apply_campaign, campaign_stats, list_campaign_templates, list_campaigns, save_campaign,
    AppliedCampaign, Campaign, CampaignInput, CampaignStats,
};

/// Kupon uygulama girdisi.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCouponArgs {
    pub coupon_code: String,
    pub basket_cents: i64,
    /// Kupon kuralı ürün/kategori kapsamı içeriyorsa kasa bu bilgiyi
    /// gönderir. Kapsam denetlenmeden indirim uygulanırsa kuralın amaçladığından
    /// fazla indirim verilmiş olur.
    #[serde(default)]
    pub in_product_scope: bool,
}

#[tauri::command]
pub async fn list_campaigns_command(
    actor_role: String,
    tenant_id: Option<String>,
    only_active: Option<bool>,
    pool: State<'_, DbPool>,
) -> Result<Vec<Campaign>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_campaigns(&mut conn, &tenant_id, only_active.unwrap_or(true)).await
}

/// Sistem şablonları tüm işletmelerin ortak kataloğudur; bu yüzden kiracı
/// bağlamı yoktur ve komut yalnız rol sınar.
#[tauri::command]
pub async fn list_campaign_templates_command(
    actor_role: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<(String, String, String)>, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;

    list_campaign_templates(&mut conn).await
}

#[tauri::command]
pub async fn get_campaign_stats(
    actor_role: String,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<CampaignStats, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    campaign_stats(&mut conn, &tenant_id).await
}

#[tauri::command]
pub async fn save_campaign_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: CampaignInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<Campaign, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<Campaign, String> = async {
        let kampanya = save_campaign(&mut conn, &tenant_id, &actor_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_MENU,
            "kampanya:saved",
            &kampanya.id,
            serde_json::json!({
                "name": kampanya.name,
                "discountPercent": kampanya.rule.discount_percent,
                "couponCode": kampanya.coupon_code,
            }),
        )
        .await?;

        Ok(kampanya)
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

/// Kuponu sepete uygular ve kullanım sayacını artırır.
///
/// Rol kapısı `OWNER` ve `MANAGER`'dır: bu komut kampanya **tanımı**
/// oluşturmaz, mevcut bir tanımı kasada geçirir. Sayaç bir kez artar ve işlem
/// `BEGIN IMMEDIATE` içinde yapılır; iki kasa aynı anda son kullanımdaki
/// kuponu kullandığında sayaç yarışı olmaz.
#[tauri::command]
pub async fn apply_campaign_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: ApplyCouponArgs,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<AppliedCampaign, String> {
    rbac::require_any(&actor_role, &[Role::Owner, Role::Manager])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<AppliedCampaign, String> = async {
        let uygulanan = apply_campaign(
            &mut conn,
            &tenant_id,
            &args.coupon_code,
            args.basket_cents,
            args.in_product_scope,
        )
        .await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            "kampanya:kupon_kullanildi",
            &uygulanan.campaign_id,
            serde_json::json!({
                "couponCode": args.coupon_code,
                "discountCents": uygulanan.discount_cents,
                "basketCents": args.basket_cents,
            }),
        )
        .await?;

        Ok(uygulanan)
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
